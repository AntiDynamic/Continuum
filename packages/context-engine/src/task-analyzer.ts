import type { ContextCoverageRequirement, TaskAnalysis, TaskAnalyzer, TaskClass } from "@continuum/shared";

const WORDS = /[A-Za-z0-9_@./-]+/g;

function requirements(taskClass: TaskClass): ContextCoverageRequirement[] {
  const required = (category: ContextCoverageRequirement["category"], reason: string): ContextCoverageRequirement => ({ category, required: true, reason });
  const preferred = (category: ContextCoverageRequirement["category"], reason: string): ContextCoverageRequirement => ({ category, required: false, reason });
  switch (taskClass) {
    case "database_migration": return [required("implementation", "Migration implementation is required."), required("database_schema", "Schema evidence is required."), required("rollback", "Rollback behavior is required."), required("tests", "Migration tests are required."), preferred("configuration", "Deployment configuration may apply."), preferred("architecture", "Architecture constraints may apply.")];
    case "security_sensitive": return [required("implementation", "Security-sensitive implementation is required."), required("tests", "Security regression tests are required."), required("security_constraint", "Repository security constraints are required."), required("public_contract", "Public security contracts are required."), preferred("architecture", "Architecture boundaries may apply.")];
    case "test_repair": case "local_bug": return [required("implementation", "The affected implementation is required."), required("tests", "Relevant test evidence is required."), preferred("public_contract", "Public contracts may constrain the fix.")];
    case "configuration": case "dependency_update": return [required("configuration", "Configuration evidence is required."), required("tests", "Validation evidence is required."), preferred("dependency", "Dependency relationships may apply.")];
    case "documentation": return [required("documentation", "The relevant documentation is required."), preferred("implementation", "Implementation may verify documentation claims.")];
    default: return [required("implementation", "Relevant implementation context is required."), preferred("tests", "Tests provide correctness evidence."), preferred("architecture", "Architecture constraints may apply.")];
  }
}

export class DeterministicTaskAnalyzer implements TaskAnalyzer {
  analyze(task: string): TaskAnalysis {
    const normalizedTask = task.trim().replace(/\s+/g, " ");
    const lower = normalizedTask.toLowerCase();
    const reasons: string[] = [];
    let taskClass: TaskClass = "unknown";
    if (/migration|schema|rollback/.test(lower)) { taskClass = "database_migration"; reasons.push("Matched migration, schema, or rollback terminology."); }
    else if (/auth|token|secret|permission|trust|security|privacy/.test(lower)) { taskClass = "security_sensitive"; reasons.push("Matched security or trust terminology."); }
    else if (/rename|extract|move|refactor/.test(lower)) { taskClass = "refactor"; reasons.push("Matched structural refactoring terminology."); }
    else if (/dependency|upgrade|version bump/.test(lower)) { taskClass = "dependency_update"; reasons.push("Matched dependency update terminology."); }
    else if (/config|configuration|yaml|json/.test(lower)) { taskClass = "configuration"; reasons.push("Matched configuration terminology."); }
    else if (/documentation|readme|docs?\b/.test(lower)) { taskClass = "documentation"; reasons.push("Matched documentation terminology."); }
    else if (/test|spec|failing/.test(lower)) { taskClass = /fix|fail|bug/.test(lower) ? "test_repair" : "local_bug"; reasons.push("Matched test or failure terminology."); }
    else if (/fix|bug|timeout|error/.test(lower)) { taskClass = "local_bug"; reasons.push("Matched localized defect terminology."); }
    else if (/add|implement|create/.test(lower)) { taskClass = "new_feature"; reasons.push("Matched feature implementation terminology."); }
    else { reasons.push("No deterministic task-class signal matched."); }

    const words = normalizedTask.match(WORDS) ?? [];
    const mentionedPaths = words.filter((word) => /[\\/]/.test(word) && /\.[A-Za-z0-9]+$/.test(word)).map((word) => word.replaceAll("\\", "/"));
    const mentionedPackages = words.filter((word) => word.startsWith("@") || /^packages\//.test(word));
    const mentionedSymbols = words.filter((word) => /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?$/.test(word) && (/[A-Z]/.test(word.slice(1)) || /[A-Z]/.test(word[0] ?? "")));
    const riskReasons: string[] = [];
    let riskLevel: TaskAnalysis["riskLevel"] = "low";
    if (taskClass === "security_sensitive") { riskLevel = "critical"; riskReasons.push("Security, authentication, secret, permission, or trust behavior is in scope."); }
    else if (taskClass === "database_migration" || taskClass === "dependency_update") { riskLevel = "high"; riskReasons.push("Persistent data or dependency compatibility is in scope."); }
    else if (taskClass === "refactor" || mentionedPackages.length > 1) { riskLevel = "medium"; riskReasons.push("The task can affect multiple files or packages."); }
    else riskReasons.push("No elevated deterministic risk signal matched.");
    const likelyLanguages = mentionedPaths.map((path) => path.split(".").pop() ?? "").filter(Boolean);
    const estimatedComplexity: TaskAnalysis["estimatedComplexity"] = mentionedPackages.length > 1 ? "cross_package" : mentionedPaths.length > 1 || taskClass === "refactor" ? "cross_file" : mentionedPaths.length === 1 || mentionedSymbols.length > 0 ? "local" : "unknown";
    return { originalTask: task, normalizedTask, taskClass, classificationReasons: reasons, mentionedPaths, mentionedSymbols, mentionedPackages, keywords: [...new Set(words.map((word) => word.toLowerCase()).filter((word) => word.length > 2))], likelyLanguages, requiredCoverage: requirements(taskClass), riskLevel, riskReasons, estimatedComplexity };
  }
}
