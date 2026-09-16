import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const infrastructurePaths = new Set([".gitignore"]);

const normalise = (path) => path.replaceAll("\\", "/").replace(/^\.\//, "");

const changedPaths = (status) => status
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => normalise(line.slice(3).split(" -> ").at(-1)))
  .filter((path) => !path.startsWith(".continuum/") && !infrastructurePaths.has(path));

const hasAny = (text, patterns) => patterns.every((pattern) => pattern.test(text));

const semanticRules = {
  "small-local-cache-timeout": [
    ["src/cache.ts", "cache implementation", [/readCache\s*\(/, /timeout/]],
    ["tests/cache.test.ts", "cache timeout regression test", [/cacheTimeoutTest/, /readCache\s*\(/]],
  ],
  "small-local-token-refresh": [
    ["src/auth-service.ts", "refresh-token implementation", [/refreshToken\s*\(/, /validateToken\s*\(/, /!token|missing token/, /expired|expiresAt/]],
    ["tests/auth-service.test.ts", "refresh-token regression test", [/refreshToken\s*\(/, /rejectsEmptyTokenTest|refreshTokenValidation|rejectsEmptyRefreshToken/, /expired|expiresAt/]],
  ],
  "mono-cross-user-session": [
    ["packages/api/src/routes.ts", "user route session propagation", [/updateUser\s*\(/, /createSession\s*\(/, /sessionId/]],
    ["packages/core/src/session.ts", "core session identity", [/createSession\s*\(/, /userId/]],
    ["packages/api/tests/routes.test.ts", "user route contract test", [/updateUserContractTest/, /sessionId|id/]],
  ],
  "mono-cross-web-contract": [
    ["packages/web/src/client.ts", "web client contract use", [/fetchUser\s*\(/, /UserResponse/]],
    ["packages/api/src/contracts.ts", "user response contract", [/UserResponse/, /id/, /sessionId/]],
  ],
  "sql-migration-users": [
    ["migrations/001_create_users.sql", "users migration and rollback", [/CREATE TABLE users/, /email/, /rollback|DROP TABLE users/]],
    ["tests/migrations.test.ts", "migration round-trip test", [/migrationRoundTripTest/, /applyMigrations/, /rollbackMigration/]],
    ["docs/schema.md", "users schema documentation", [/Users/, /email/, /rollback/i]],
  ],
  "sql-migration-refresh": [
    ["migrations/002_add_refresh_token.sql", "refresh-token migration", [/refresh_token_hash/, /CREATE INDEX/, /rollback/i]],
    ["docs/schema.md", "refresh-token schema documentation", [/refresh token hash|refresh_token_hash/i, /rollback/i]],
    ["tests/migrations.test.ts", "migration regression test", [/migrationRoundTripTest/, /rollbackMigration/]],
  ],
  "small-api-contract": [
    ["src/api.ts", "user API contract", [/UserApi/, /getUser\s*\(/, /id/]],
  ],
  "mono-api-contract": [
    ["packages/api/src/contracts.ts", "user response contract", [/UserResponse/, /id/, /sessionId/]],
    ["packages/api/src/routes.ts", "user route implementation", [/updateUser\s*\(/, /sessionId/]],
    ["packages/api/tests/routes.test.ts", "user route contract test", [/updateUserContractTest/, /id/]],
  ],
  "small-security-token": [
    ["src/auth-service.ts", "token validation implementation", [/validateToken\s*\(/, /!token|missing token/, /expired|expiresAt/]],
    ["tests/auth-service.test.ts", "token validation tests", [/rejectsEmptyTokenTest/, /validateToken\s*\(/]],
    ["SECURITY.md", "token trust policy", [/empty/, /expired/, /refresh/i]],
  ],
  "sql-security-refresh": [
    ["migrations/002_add_refresh_token.sql", "hashed refresh-token schema", [/refresh_token_hash/, /rollback/i]],
    ["tests/migrations.test.ts", "refresh-token migration test", [/migrationRoundTripTest/, /rollbackMigration/]],
    ["SECURITY.md", "plaintext-token prohibition", [/plaintext/i, /hash/i]],
  ],
  "small-config-timeout": [
    ["config/app.yaml", "application timeout configuration", [/timeoutMs\s*:/]],
    ["src/app-config.ts", "application config loader", [/loadAppConfig\s*\(/, /timeoutMs/]],
  ],
  "mono-config-workspace": [
    ["config/workspace.yaml", "workspace timeout configuration", [/sessionTimeoutMs\s*:/]],
    ["packages/config/src/settings.ts", "workspace config loader", [/loadWorkspaceSettings\s*\(/, /sessionTimeoutMs/]],
  ],
  "small-doc-mismatch": [
    ["docs/authentication.md", "authentication timeout documentation", [/AuthService/, /timeout/i]],
    ["src/auth-service.ts", "authentication implementation", [/AuthService/, /validateToken\s*\(/]],
    ["src/app-config.ts", "authentication configuration source", [/loadAppConfig\s*\(/, /timeoutMs/]],
  ],
};

const verifySemanticRules = async (repository, taskId) => {
  const rules = semanticRules[taskId];
  if (!rules) return { status: "not_configured", checks: [] };
  const checks = [];
  for (const [relativePath, name, patterns] of rules) {
    try {
      const content = await readFile(resolve(repository, relativePath), "utf8");
      checks.push({ name, path: relativePath, status: hasAny(content, patterns) ? "passed" : "failed" });
    } catch (error) {
      checks.push({ name, path: relativePath, status: "failed", error: String(error) });
    }
  }
  return { status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks };
};

export async function verifyPhase6Task({ repository, task, status }) {
  const changed = changedPaths(status);
  const result = {
    status: "failed",
    taskId: task.id,
    changedPaths: changed,
    scope: { status: "failed", unexpectedPaths: [] },
    checks: [],
  };

  const expected = new Set(task.requiredPaths.map(normalise));
  result.scope.unexpectedPaths = changed.filter((path) => !expected.has(path));
  result.scope.status = result.scope.unexpectedPaths.length === 0 ? "passed" : "failed";
  result.checks.push({ name: "patch-scope", status: result.scope.status });
  const missingRequiredChanges = task.requiredPaths.map(normalise).filter((path) => !changed.includes(path));
  result.checks.push({ name: "required-path-changes", status: missingRequiredChanges.length === 0 ? "passed" : "failed", missingPaths: missingRequiredChanges });
  const semantic = await verifySemanticRules(repository, task.id);
  result.checks.push(...semantic.checks);
  const failed = result.checks.some((check) => check.status === "failed") || semantic.status === "failed";
  result.failureCategories = [
    ...(result.scope.status === "failed" ? ["scope_violation"] : []),
    ...(missingRequiredChanges.length > 0 ? ["missing_required_changes"] : []),
    ...(semantic.status === "failed" ? ["semantic_requirement_failed"] : []),
  ];
  result.status = failed ? "failed" : semantic.status === "not_configured" ? "partial" : "passed";
  return result;
}
