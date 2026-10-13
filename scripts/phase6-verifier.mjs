import { verifyBehavior } from "./phase6-behavior.mjs";

const infrastructurePaths = new Set([".gitignore", "opencode.json"]);

const normalise = (path) => path.replaceAll("\\", "/").replace(/^\.\//, "");

const changedPaths = (status) => status
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => normalise(line.slice(3).split(" -> ").at(-1)))
  .filter((path) => !path.startsWith(".continuum/") && !infrastructurePaths.has(path));

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
  const semantic = await verifyBehavior({ repository, taskId: task.id });
  result.checks.push(...semantic.checks);
  result.behavioral = semantic.behavioral === true;
  result.validator = semantic.validator;
  const failed = result.checks.some((check) => check.status === "failed") || semantic.status === "failed";
  result.failureCategories = [
    ...(result.scope.status === "failed" ? ["scope_violation"] : []),
    ...(missingRequiredChanges.length > 0 ? ["missing_required_changes"] : []),
    ...(semantic.status === "failed" ? ["semantic_requirement_failed"] : []),
  ];
  result.status = failed ? "failed" : semantic.status === "not_configured" ? "partial" : "passed";
  return result;
}
