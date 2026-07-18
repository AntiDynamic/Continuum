import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeterministicTaskAnalyzer } from "../src/task-analyzer.js";

describe("deterministic retrieval fixture contracts", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
  const files = readdirSync(root).filter((file) => file.endsWith(".json")).sort();
  it("defines five deterministic, non-overlapping benchmark scenarios", () => {
    expect(files).toHaveLength(5);
    const analyzer = new DeterministicTaskAnalyzer();
    for (const file of files) {
      const fixture = JSON.parse(readFileSync(join(root, file), "utf8")) as { task: string; requiredContext: string[]; irrelevantContext: string[]; expectedTaskClass: string };
      expect(analyzer.analyze(fixture.task).taskClass).toBe(fixture.expectedTaskClass);
      expect(fixture.requiredContext.length).toBeGreaterThan(1);
      expect(fixture.irrelevantContext.length).toBeGreaterThan(1);
      expect(fixture.requiredContext.filter((item) => fixture.irrelevantContext.includes(item))).toEqual([]);
    }
  });
});
