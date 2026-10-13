import { describe, expect, it } from "vitest";
import { ContextSessionRepository, migrate, openDatabase } from "@continuum/database";
import type { ContextCacheDelivery, IndexSnapshotIdentity } from "@continuum/shared";

describe("persisted cache delivery", () => {
  it("round-trips the stable prefix payload and task-delta manifest", () => {
    const db = openDatabase(":memory:");
    try {
      migrate(db);
      db.prepare("INSERT INTO repositories(id,canonical_path,name,created_at,updated_at) VALUES(1,'/cache-delivery','cache-delivery','2026-09-20','2026-09-20')").run();
      const snapshot: IndexSnapshotIdentity = { snapshot_kind: "commit", base_commit_hash: "commit-a", worktree_hash: null, dirty: false };
      const sessions = new ContextSessionRepository(db);
      const session = sessions.create({ repositoryId: 1, taskText: "Fix cache delivery", taskAnalysisJson: "{}", snapshot, strategyId: "deterministic", strategyVersion: "v1", maximumEstimatedTokens: 1000 });
      sessions.activate(session.id);
      const cacheDelivery: ContextCacheDelivery = {
        schemaVersion: "continuum.context-cache-delivery.v1",
        stablePrefix: { role: "stable_prefix", repositoryId: 1, strategyVersion: "v1", snapshot, contentHash: "stable-hash", estimatedTokens: 20, itemIds: ["map-item"], content: "stable repository prefix" },
        taskDelta: { role: "task_delta", repositoryId: 1, strategyVersion: "v1", snapshot, contentHash: "delta-hash", estimatedTokens: 30, itemIds: ["task-item"] },
      };
      sessions.recordDelivery({ sessionId: session.id, stage: "orientation", trigger: { type: "initial" }, reason: "test", items: [], coverageAdded: [], coverageRemaining: [], estimatedDuplicateTokensAvoided: 0, expectedSnapshot: snapshot, decision: {}, cacheDelivery });
      const persisted = sessions.listDeliveries(session.id)[0];
      expect(persisted?.cache_delivery_json).toBe(JSON.stringify(cacheDelivery));
      expect(JSON.parse(persisted!.cache_delivery_json!)).toEqual(cacheDelivery);
    } finally {
      db.close();
    }
  });
});
