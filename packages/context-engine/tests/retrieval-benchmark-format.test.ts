import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RetrievalBenchmarkDataset } from "../benchmarks/v1/format.js";

const categories = [
  "exact_symbol", "exact_path", "local_bug", "cross_package", "test_failure", "security",
  "database_migration", "api_contract", "configuration", "documentation_mismatch", "ambiguous_behaviour",
] as const;

describe("retrieval benchmark v1 format", () => {
  it("contains 24 manually labelled cases across every required category", async () => {
    const path = resolve(import.meta.dirname, "../benchmarks/v1/cases.json");
    const dataset = JSON.parse(await readFile(path, "utf8")) as RetrievalBenchmarkDataset;
    expect(dataset.schemaVersion).toBe("continuum.retrieval-benchmark.v1");
    expect(dataset.groundTruthPolicy).toContain("Manually declared before executing rankings");
    expect(dataset.cases).toHaveLength(24);
    expect(new Set(dataset.cases.map((item) => item.repositoryFixture))).toEqual(new Set(["small-ts", "monorepo", "sql-docs"]));
    for (const category of categories) expect(dataset.cases.some((item) => item.category === category)).toBe(true);
    for (const item of dataset.cases) {
      expect(item.id).toBeTruthy();
      expect(item.task).toBeTruthy();
      expect(item.requiredItemIds.length).toBeGreaterThan(0);
      expect(item.requiredPaths.length + item.requiredSymbols.length).toBeGreaterThan(0);
      expect(item.requiredCoverage.length).toBeGreaterThan(0);
    }
  });
});
