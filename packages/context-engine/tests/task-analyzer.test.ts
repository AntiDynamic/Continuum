import { describe, expect, it } from "vitest";
import { DeterministicTaskAnalyzer } from "../src/task-analyzer.js";

describe("DeterministicTaskAnalyzer", () => {
  const analyzer = new DeterministicTaskAnalyzer();

  it.each([
    ["Fix parseGeminiLine timeout in packages/gemini-adapter/src/parser.ts", "local_bug", "low"],
    ["Refactor @continuum/database and @continuum/shared", "refactor", "medium"],
    ["Add schema migration and rollback", "database_migration", "high"],
    ["Fix authentication token trust permissions", "security_sensitive", "critical"],
    ["Update README documentation", "documentation", "low"],
    ["ponder the repository", "unknown", "low"],
  ] as const)("classifies %s", (task, taskClass, riskLevel) => {
    const result = analyzer.analyze(task);
    expect(result.taskClass).toBe(taskClass);
    expect(result.riskLevel).toBe(riskLevel);
    expect(result.classificationReasons.length).toBeGreaterThan(0);
    expect(result.riskReasons.length).toBeGreaterThan(0);
  });

  it("extracts explicit path, symbol, and package signals", () => {
    const result = analyzer.analyze("Fix parseGeminiLine in packages/gemini-adapter/src/parser.ts for @continuum/gemini-adapter");
    expect(result.mentionedPaths).toContain("packages/gemini-adapter/src/parser.ts");
    expect(result.mentionedSymbols).toContain("parseGeminiLine");
    expect(result.mentionedPackages).toContain("@continuum/gemini-adapter");
  });
});
