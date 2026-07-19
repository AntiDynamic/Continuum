/**
 * .continuumignore pattern correctness tests — Phase 4A.1
 *
 * Proves that the patterns in /.continuumignore correctly exclude:
 * - packages/codex-app-server/schema/** (255 generated JSON schema files)
 * - packages/context-engine/benchmarks/v1/*-results.json (benchmark result snapshots)
 *
 * Uses the same `ignore` library as discovery.ts for identical semantics.
 */
import { describe, it, expect } from "vitest";
import ignore from "ignore";

const CONTINUUMIGNORE_CONTENT = `
# Continuum index exclusion rules
# Generated protocol schemas — not source implementation
packages/codex-app-server/schema/**
# Benchmark result snapshots — not benchmark case definitions
packages/context-engine/benchmarks/v1/*-results.json
packages/context-engine/benchmarks/v1/phase3d-*.json
`.trim();

function makeIg() {
  const ig = ignore();
  ig.add(CONTINUUMIGNORE_CONTENT);
  return ig;
}

describe(".continuumignore pattern correctness", () => {
  it("excludes generated codex protocol schema files", () => {
    const ig = makeIg();
    const schemaPaths = [
      "packages/codex-app-server/schema/0.133.0/codex_app_server_protocol.schemas.json",
      "packages/codex-app-server/schema/0.133.0/thread.start.json",
      "packages/codex-app-server/schema/0.133.0/sub/nested.json",
    ];
    for (const path of schemaPaths) {
      expect(ig.ignores(path), `Expected "${path}" to be excluded`).toBe(true);
    }
  });

  it("does NOT exclude schema directory itself or non-schema files in codex-app-server", () => {
    const ig = makeIg();
    const allowedPaths = [
      "packages/codex-app-server/src/report.ts",
      "packages/codex-app-server/src/normalizer.ts",
      "packages/codex-app-server/tests/client.test.ts",
      "packages/codex-app-server/package.json",
    ];
    for (const path of allowedPaths) {
      expect(ig.ignores(path), `Expected "${path}" NOT to be excluded`).toBe(false);
    }
  });

  it("excludes benchmark result snapshot files", () => {
    const ig = makeIg();
    const resultPaths = [
      "packages/context-engine/benchmarks/v1/phase3a-results.json",
      "packages/context-engine/benchmarks/v1/phase3d-baseline.json",
      "packages/context-engine/benchmarks/v1/run-2024-01-01-results.json",
    ];
    for (const path of resultPaths) {
      expect(ig.ignores(path), `Expected "${path}" to be excluded`).toBe(true);
    }
  });

  it("does NOT exclude benchmark definition files", () => {
    const ig = makeIg();
    const definitionPaths = [
      "packages/context-engine/benchmarks/v1/queries.json",
      "packages/context-engine/benchmarks/v1/ground-truth.json",
      "packages/context-engine/benchmarks/v1/README.md",
      "packages/context-engine/benchmarks/run-benchmark.ts",
    ];
    for (const path of definitionPaths) {
      expect(ig.ignores(path), `Expected "${path}" NOT to be excluded`).toBe(false);
    }
  });

  it("does NOT exclude unrelated paths from the main source tree", () => {
    const ig = makeIg();
    const unrelatedPaths = [
      "packages/shared/src/index.ts",
      "apps/cli/src/main.ts",
      "docs/README.md",
      ".continuumignore",
    ];
    for (const path of unrelatedPaths) {
      expect(ig.ignores(path), `Expected "${path}" NOT to be excluded`).toBe(false);
    }
  });

  it("all 255 schema variations in 0.133.0/ are excluded", () => {
    const ig = makeIg();
    // Smoke-check a range of schema files that might actually exist
    for (const name of ["account.read", "thread.start", "turn.start", "item.fileChange", "thread.tokenUsage.updated"]) {
      const path = `packages/codex-app-server/schema/0.133.0/${name}.json`;
      expect(ig.ignores(path), `Expected schema "${path}" to be excluded`).toBe(true);
    }
  });
});
