import { describe, expect, it } from "vitest";
import type { DeltaContextPacket } from "@continuum/shared";
import { buildContextEnvelope } from "../src/assist-context-envelope.js";

describe("Codex context envelope", () => {
  it("sends the stable prefix once and keeps task items as the delta", () => {
    const packet = {
      cacheDelivery: {
        schemaVersion: "continuum.context-cache-delivery.v1",
        stablePrefix: { role: "stable_prefix", repositoryId: 1, strategyVersion: "v1", snapshot: { snapshot_kind: "commit", base_commit_hash: "abc", worktree_hash: null, dirty: false }, contentHash: "stable-hash", estimatedTokens: 20, itemIds: [], content: "stable repository map" },
        taskDelta: { role: "task_delta", repositoryId: 1, strategyVersion: "v1", snapshot: { snapshot_kind: "commit", base_commit_hash: "abc", worktree_hash: null, dirty: false }, contentHash: "delta-hash", estimatedTokens: 10, itemIds: ["item-1"] },
      },
      newItems: [{ candidate: { item: { source_path: "src/auth.ts", contextual_header: null }, } as any, content: "refreshToken()", truncated: false }],
    } as unknown as DeltaContextPacket;

    const envelope = buildContextEnvelope(packet);
    expect(envelope).toContain("stable repository map");
    expect(envelope.match(/stable repository map/g)).toHaveLength(1);
    expect(envelope).toContain("refreshToken()");
  });
});
