import { describe, expect, it } from "vitest";
import { CharacterRatioTokenEstimator, type ContextCandidate, type ContextCoverageReport, type ContextItemVersion, type ContextPacketItem, type ContextProvenance, type IndexSnapshotIdentity, type TaskAnalysis } from "@continuum/shared";
import { buildContextCachePlan } from "../src/cache-plan.js";

const snapshot: IndexSnapshotIdentity = { snapshot_kind: "commit", base_commit_hash: "commit-a", worktree_hash: null, dirty: false };
const task = (originalTask: string): TaskAnalysis => ({
  originalTask,
  normalizedTask: originalTask.toLowerCase(),
  taskClass: "local_bug",
  classificationReasons: ["fixture"],
  mentionedPaths: ["src/auth.ts"],
  mentionedSymbols: ["refreshToken"],
  mentionedPackages: [],
  keywords: ["auth", "refresh"],
  likelyLanguages: ["typescript"],
  requiredCoverage: [{ category: "implementation", state: "required", required: true, reason: "The implementation must be available." }],
  riskLevel: "medium",
  riskReasons: ["fixture"],
  estimatedComplexity: "local",
});

const version = (id: string, path: string, symbol: string, contentHash: string): ContextItemVersion => ({
  id,
  context_item_id: `${id}-item`,
  content: `source ${id}`,
  contextual_header: `File: ${path}`,
  compiled_content: `compiled ${id}`,
  title: symbol,
  source_path: path,
  source_start_line: 1,
  source_end_line: 5,
  symbol_name: symbol,
  language: "typescript",
  content_hash: contentHash,
  source_blob_hash: `${id}-blob`,
  valid_from_commit: snapshot.base_commit_hash,
  valid_to_commit_exclusive: null,
  indexed_at: "2026-09-20T00:00:00.000Z",
  provenance_json: null,
  staleness_status: "current",
  staleness_reason: null,
  metadata_json: null,
});

const item = (value: ContextItemVersion): ContextPacketItem => {
  const provenance: ContextProvenance = { repositoryId: 1, sourcePath: value.source_path, sourceStartLine: value.source_start_line, sourceEndLine: value.source_end_line, extractor: "fixture", snapshot, confidence: "high" };
  const candidate: ContextCandidate = {
    item: value,
    score: 5,
    components: { exactSymbol: 1, exactTitle: 0, exactPath: 0, lexical: 1, contextualHeader: 0, dependencyRelation: 0, testRelation: 0, architectureRelation: 0, configurationRelation: 0, priorEpisodeRelation: 0, taskClassRelevance: 1, riskCoverage: 1, currentSnapshot: 1, uncommittedPenalty: 0, stalenessPenalty: 0, historicalPenalty: 0, tokenCostPenalty: 0, duplicatePenalty: 0 },
    reasons: ["fixture"],
    coverageCategories: ["implementation"],
    estimatedTokens: 5,
    provenance,
    lexicalEvidence: { backend: "fallback_lexical", rawScore: 1, normalizedScore: 1, normalizationMethod: "fixture" },
  };
  return { candidate, content: value.compiled_content ?? value.content, truncated: false };
};

const coverage: ContextCoverageReport = {
  requirements: task("placeholder").requiredCoverage,
  covered: ["implementation"],
  missing: [],
  coverageEvidence: [{ category: "implementation", state: "required", reason: "fixture", matchingIndexedCandidateCount: 1, contextItemVersionIds: ["implementation"], remainingRequirement: false, additionalEstimatedBudgetRequired: 0, explanation: "covered" }],
  complete: true,
};

describe("context cache plan", () => {
  it("keeps the stable prefix deterministic and task-independent", () => {
    const implementation = item(version("implementation", "src/auth.ts", "refreshToken", "hash-auth"));
    const orientation = item(version("orientation", "README.md", "README", "hash-readme"));
    const packet = { task: task("Fix the refresh token race"), orientation: { items: [orientation], estimatedTokens: 5 }, implementation: { items: [implementation], estimatedTokens: 5 }, omittedItems: [], coverage };
    const first = buildContextCachePlan(1, snapshot, "strategy-v1", packet, [version("orientation", "README.md", "README", "hash-readme"), version("implementation", "src/auth.ts", "refreshToken", "hash-auth")], new CharacterRatioTokenEstimator());
    const second = buildContextCachePlan(1, snapshot, "strategy-v1", { ...packet, task: task("Update the refresh token tests") }, [version("implementation", "src/auth.ts", "refreshToken", "hash-auth"), version("orientation", "README.md", "README", "hash-readme")], new CharacterRatioTokenEstimator());

    expect(first.schemaVersion).toBe("continuum.context-cache-plan.v1");
    expect(first.stablePrefix.content).not.toContain("Fix the refresh token race");
    expect(first.stablePrefix.content).toBe(second.stablePrefix.content);
    expect(first.stablePrefix.contentHash).toBe(second.stablePrefix.contentHash);
    expect(first.taskDelta.contentHash).not.toBe(second.taskDelta.contentHash);
    expect(first.stablePrefix.itemIds).toEqual(["orientation", "implementation"]);
    expect(first.taskDelta.itemIds).toEqual(["orientation", "implementation"]);
    expect(first.taskDelta.content).toContain("PROVENANCE: src/auth.ts:1-5 via fixture");
  });

  it("binds both layers to the indexed snapshot", () => {
    const implementation = item(version("implementation", "src/auth.ts", "refreshToken", "hash-auth"));
    const packet = { task: task("Fix the refresh token race"), orientation: { items: [], estimatedTokens: 0 }, implementation: { items: [implementation], estimatedTokens: 5 }, omittedItems: [], coverage };
    const changedSnapshot: IndexSnapshotIdentity = { ...snapshot, base_commit_hash: "commit-b" };
    const first = buildContextCachePlan(1, snapshot, "strategy-v1", packet, [implementation.candidate.item], new CharacterRatioTokenEstimator());
    const second = buildContextCachePlan(1, changedSnapshot, "strategy-v1", packet, [implementation.candidate.item], new CharacterRatioTokenEstimator());

    expect(first.stablePrefix.content).toContain("SNAPSHOT: commit/commit-a//clean");
    expect(second.stablePrefix.content).toContain("SNAPSHOT: commit/commit-b//clean");
    expect(first.stablePrefix.contentHash).not.toBe(second.stablePrefix.contentHash);
    expect(first.taskDelta.contentHash).not.toBe(second.taskDelta.contentHash);
  });
});
