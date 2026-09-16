import { describe, expect, it } from "vitest";
import { buildContinuumCompactionPrompt } from "../src/compaction-policy.js";
import { normalizeCodexMessage } from "../src/normalizer.js";

describe("Codex compaction policy", () => {
  it("keeps recovery coordinates without copying source contents", () => {
    const prompt = buildContinuumCompactionPrompt({
      schemaVersion: "continuum.context-recovery.v1",
      sessionId: "session-1",
      task: "Fix the context pipeline",
      status: "active",
      snapshot: { snapshot_kind: "commit", base_commit_hash: "abc", worktree_hash: null, dirty: false },
      budget: { maximumEstimatedTokens: 8000, deliveredEstimatedTokens: 1200, activeEstimatedTokens: 900, remainingEstimatedTokens: 6800 },
      progress: { deliveryCount: 1, signalCount: 0, activeContextItemCount: 2 },
      activeContext: [{ contextItemVersionId: "item-1", contentHash: "hash", sourcePath: "src/context.ts", title: "Context engine", estimatedTokens: 100 }],
      requiredCoverage: ["implementation"],
      coverageRemaining: ["tests"],
      blockers: ["A test is failing"],
      nextAction: "Retrieve context for: tests",
    });
    expect(prompt).toContain("session-1");
    expect(prompt).toContain("src/context.ts");
    expect(prompt).toContain("Retrieve context for: tests");
    expect(prompt).not.toContain("export const");
  });

  it("normalizes both Codex compaction event forms", () => {
    const item = normalizeCodexMessage({
      direction: "server_to_client", category: "notification", raw: "{}", parsed: {
        method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", item: { id: "compact-1", type: "contextCompaction" } },
      }, method: "item/completed", requestId: null, timestamp: new Date().toISOString(),
    });
    const legacy = normalizeCodexMessage({
      direction: "server_to_client", category: "notification", raw: "{}", parsed: {
        method: "thread/compacted", params: { threadId: "thread-1", turnId: "turn-1" },
      }, method: "thread/compacted", requestId: null, timestamp: new Date().toISOString(),
    });
    expect(item.normalized[0]?.eventType).toBe("context_compaction");
    expect(legacy.normalized[0]?.eventType).toBe("context_compaction");
  });
});
