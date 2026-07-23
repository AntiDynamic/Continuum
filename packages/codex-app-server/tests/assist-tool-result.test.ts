import { describe, expect, it } from "vitest";
import type {
  ContextCoverageCategory,
  ContextPacketItem,
  DeltaContextPacket,
} from "@continuum/shared";
import {
  buildAssistContextToolResult,
  parseAssistContextToolResult,
  serializeAssistContextToolResult,
} from "../src/assist-tool-result.js";

function packetItem(
  id: string,
  estimatedTokens: number,
  coverageCategories: ContextCoverageCategory[],
): ContextPacketItem {
  return {
    candidate: {
      item: {
        id, context_item_id: `item-${id}`, content: id, contextual_header: null, compiled_content: null,
        title: id, source_path: `src/${id}.ts`, source_start_line: 1, source_end_line: 1,
        symbol_name: id, language: "typescript", content_hash: `hash-${id}`, source_blob_hash: `blob-${id}`,
        valid_from_commit: "abc", valid_to_commit_exclusive: null, indexed_at: "2026-01-01T00:00:00.000Z",
        provenance_json: null, staleness_status: "current", staleness_reason: null, metadata_json: null,
      },
      score: 1,
      components: {
        exactSymbol: 0, exactTitle: 0, exactPath: 0, lexical: 1, contextualHeader: 0,
        dependencyRelation: 0, testRelation: 0, architectureRelation: 0, configurationRelation: 0,
        priorEpisodeRelation: 0, taskClassRelevance: 0, riskCoverage: 0, currentSnapshot: 1,
        uncommittedPenalty: 0, stalenessPenalty: 0, historicalPenalty: 0, tokenCostPenalty: 0,
        duplicatePenalty: 0,
      },
      reasons: ["test"], coverageCategories, estimatedTokens,
      provenance: {
        repositoryId: 1, sourcePath: `src/${id}.ts`, sourceStartLine: 1, sourceEndLine: 1,
        extractor: "test", snapshot: { snapshot_kind: "commit", base_commit_hash: "abc", worktree_hash: null, dirty: false },
        confidence: "high",
      },
      lexicalEvidence: { backend: "fts5", rawScore: 1, normalizedScore: 1, normalizationMethod: "test" },
    },
    content: `content-${id}`,
    truncated: false,
  };
}

function packet(items: ContextPacketItem[]): DeltaContextPacket {
  return {
    id: "delivery", sessionId: "session", stage: "escalation", newItems: items,
    restoredItems: [], activeReferences: [], omittedItems: [],
    estimatedNewTokens: items.reduce((total, item) => total + item.candidate.estimatedTokens, 0),
    estimatedRestoredTokens: 0, estimatedDuplicateTokensAvoided: 0,
    coverageAdded: [], coverageRemaining: [], trigger: "agent_request",
    strategyId: "strategy", strategyVersion: "v1", decisionReasons: [],
    incomplete: false,
  };
}

const options = (maximumResultTokens: number) => ({
  maximumResultTokens, maximumToolCalls: 8, toolCallsUsed: 1,
  sessionEstimatedTokensUsed: 10, remainingSessionTokens: 100,
});

describe("continuum.assist-tool-result.v1", () => {
  it("strictly validates canonical results and rejects unknown fields", () => {
    const result = buildAssistContextToolResult(packet([packetItem("required", 10, ["implementation"])]), options(10));
    const serialized = serializeAssistContextToolResult(result);
    expect(parseAssistContextToolResult(serialized)).toEqual(result);
    expect(() => parseAssistContextToolResult(JSON.stringify({ ...result, unknown: true }))).toThrow();
    expect(() => parseAssistContextToolResult(JSON.stringify({
      ...result,
      references: [{ contextItemVersionId: "x", sourcePath: "x.ts", symbol: null, startLine: 1, endLine: 1, contentHash: "x", estimatedTokensAvoided: 1, content: "forbidden" }],
    }))).toThrow();
  });

  it("keeps required content and omits recommended overflow", () => {
    const result = buildAssistContextToolResult(packet([
      packetItem("required", 10, ["implementation"]),
      packetItem("recommended", 8, ["tests"]),
    ]), options(10));
    expect(result).toMatchObject({ success: true, estimatedNewTokens: 10, incomplete: true, additionalEstimatedTokensRequired: 8 });
    expect(result.newItems.map((item) => item.contextItemVersionId)).toEqual(["required"]);
    expect(result.omittedItems).toHaveLength(1);
  });

  it("refuses required-only overflow and bounds optional-only overflow", () => {
    expect(buildAssistContextToolResult(
      packet([packetItem("required", 11, ["implementation"])]), options(10),
    )).toMatchObject({ success: false, failureCode: "RESULT_TOKEN_LIMIT", limitReached: true });
    const optional = buildAssistContextToolResult(
      packet([packetItem("optional", 11, ["documentation"])]), options(10),
    );
    expect(optional).toMatchObject({ success: true, estimatedNewTokens: 0, incomplete: true, additionalEstimatedTokensRequired: 11 });
  });

  it("handles exactly-at-limit and reference-only results", () => {
    expect(buildAssistContextToolResult(
      packet([packetItem("required", 10, ["implementation"])]), options(10),
    )).toMatchObject({ success: true, estimatedNewTokens: 10, incomplete: false });
    const referencePacket = packet([]);
    referencePacket.activeReferences = [{
      contextItemVersionId: "existing", contentHash: "hash", sourcePath: "src/existing.ts", estimatedTokens: 25,
    }];
    referencePacket.estimatedDuplicateTokensAvoided = 25;
    const result = buildAssistContextToolResult(referencePacket, options(1));
    expect(result).toMatchObject({ success: true, estimatedNewTokens: 0, estimatedDuplicateTokensAvoided: 25 });
    expect(result.references).toHaveLength(1);
    expect(result.references[0]).not.toHaveProperty("content");
  });

  it("refuses a request that exceeds the remaining total session budget", () => {
    const result = buildAssistContextToolResult(
      packet([packetItem("required", 10, ["implementation"])]),
      { ...options(10), remainingSessionTokens: 9 },
    );
    expect(result).toMatchObject({ success: false, failureCode: "SESSION_TOKEN_LIMIT", deliveryId: null });
  });
});
