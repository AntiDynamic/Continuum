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

  if (task.id === "small-local-token-refresh") {
    const source = await readFile(resolve(repository, "src/auth-service.ts"), "utf8");
    const tests = await readFile(resolve(repository, "tests/auth-service.test.ts"), "utf8");
    const sourcePassed = hasAny(source, [
      /refreshToken\s*\(/,
      /validateToken\s*\(/,
      /if\s*\(\s*!token\s*\)/,
      /expired/,
    ]);
    const testsPassed = hasAny(tests, [
      /refreshToken\s*\(/,
      /refreshTokenValidation|rejectsEmptyRefreshToken|refreshTokenRejectsEmptyToken/,
      /expired/,
    ]);
    result.checks.push({ name: "refresh-token-implementation", status: sourcePassed ? "passed" : "failed" });
    result.checks.push({ name: "refresh-token-regression-tests", status: testsPassed ? "passed" : "failed" });
  } else {
    result.checks.push({ name: "task-specific-semantic-check", status: "not_configured" });
  }

  const failed = result.checks.some((check) => check.status === "failed");
  const unconfigured = result.checks.some((check) => check.status === "not_configured");
  result.status = failed ? "failed" : unconfigured ? "partial" : "passed";
  return result;
}
