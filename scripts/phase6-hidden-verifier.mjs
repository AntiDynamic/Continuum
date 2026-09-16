import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const rules = {
  "small-local-cache-timeout": [
    ["src/cache.ts", "timeout is a cache miss", [/key\s*===\s*["']timeout["']/, /undefined/]],
    ["tests/cache.test.ts", "timeout regression assertion", [/cacheTimeoutTest/, /readCache\s*\(\s*["']timeout["']\s*\)/, /undefined/]],
  ],
  "small-local-token-refresh": [
    ["src/auth-service.ts", "refresh delegates token validation", [/refreshToken\s*\([^)]*\)[^{]*\{[^}]*validateToken\s*\(/s]],
    ["tests/auth-service.test.ts", "invalid refresh token regression", [/refreshToken\s*\(/, /empty|expired|invalid/i]],
  ],
  "mono-cross-user-session": [
    ["packages/api/src/routes.ts", "route creates session for input user", [/createSession\s*\(\s*id\s*\)/, /sessionId/]],
    ["packages/core/src/session.ts", "session preserves user identity", [/userId/, /createSession/]],
    ["packages/api/tests/routes.test.ts", "route test checks session identity", [/sessionId/, /session-u1|createSession/]],
  ],
  "mono-cross-web-contract": [
    ["packages/web/src/client.ts", "web client returns UserResponse", [/fetchUser/, /UserResponse/, /sessionId/]],
    ["packages/api/src/contracts.ts", "API contract includes sessionId", [/UserResponse/, /sessionId/]],
  ],
  "sql-migration-users": [
    ["migrations/001_create_users.sql", "users migration is reversible", [/CREATE TABLE users/i, /DROP TABLE users/i]],
    ["tests/migrations.test.ts", "users migration test", [/migrationRoundTripTest/, /applyMigrations/, /rollbackMigration/]],
    ["docs/schema.md", "users schema documentation", [/Users/, /email/, /rollback/i]],
  ],
  "sql-migration-refresh": [
    ["migrations/002_add_refresh_token.sql", "hashed refresh token column", [/refresh_token_hash/, /CREATE INDEX/, /rollback/i], [/ADD COLUMN\s+refresh_token\s+TEXT/i]],
    ["docs/schema.md", "hashed refresh token documentation", [/refresh[_ ]token[_ ]hash/i, /rollback/i]],
    ["tests/migrations.test.ts", "refresh migration test", [/migrationRoundTripTest/, /rollbackMigration/, /002|refresh/i]],
  ],
  "small-api-contract": [
    ["src/api.ts", "user API contract", [/UserApi/, /getUser\s*\(/, /id/]],
  ],
  "mono-api-contract": [
    ["packages/api/src/contracts.ts", "response contract", [/UserResponse/, /id/, /sessionId/]],
    ["packages/api/src/routes.ts", "route returns contract fields", [/updateUser/, /sessionId/]],
    ["packages/api/tests/routes.test.ts", "route contract test", [/updateUserContractTest/, /sessionId/]],
  ],
  "small-security-token": [
    ["src/auth-service.ts", "empty and expired token rejection", [/!token|missing token/, /expired/]],
    ["tests/auth-service.test.ts", "security regression coverage", [/rejectsEmptyTokenTest/, /expired|expiresAt/i]],
    ["SECURITY.md", "security policy", [/empty/, /expired/i]],
  ],
  "sql-security-refresh": [
    ["migrations/002_add_refresh_token.sql", "hashed token storage", [/refresh_token_hash/, /rollback/i], [/ADD COLUMN\s+refresh_token\s+TEXT/i]],
    ["tests/migrations.test.ts", "security migration test", [/migrationRoundTripTest/, /refresh|002/i]],
    ["SECURITY.md", "plaintext token prohibition", [/plaintext/i, /hash/i]],
  ],
  "small-config-timeout": [
    ["config/app.yaml", "configured timeout", [/timeoutMs\s*:/]],
    ["src/app-config.ts", "loaded timeout", [/loadAppConfig/, /timeoutMs/]],
  ],
  "small-doc-mismatch": [
    ["docs/authentication.md", "authentication documentation", [/AuthService/, /timeout/i]],
    ["src/auth-service.ts", "authentication implementation", [/AuthService/, /validateToken/]],
    ["src/app-config.ts", "authentication configuration", [/loadAppConfig/, /timeoutMs/]],
  ],
};

const checkPatterns = (content, required, forbidden = []) => required.every((pattern) => pattern.test(content)) && forbidden.every((pattern) => !pattern.test(content));

export async function verifyPhase6HiddenTask({ repository, taskId }) {
  const taskRules = rules[taskId];
  if (!taskRules) return { status: "not_configured", taskId, checks: [] };
  const checks = [];
  for (const [relativePath, name, required, forbidden = []] of taskRules) {
    try {
      const content = await readFile(resolve(repository, relativePath), "utf8");
      checks.push({ name, path: relativePath, status: checkPatterns(content, required, forbidden) ? "passed" : "failed" });
    } catch (error) {
      checks.push({ name, path: relativePath, status: "failed", error: String(error) });
    }
  }
  return { status: checks.every((check) => check.status === "passed") ? "passed" : "failed", taskId, checks, validator: "phase6-hidden-verifier.v1" };
}
