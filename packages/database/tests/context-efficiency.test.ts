import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ContextLedgerRepository,
  ContextRepository,
  CostEvidenceRepository,
  PricingProfileRepository,
  RepositoryRepository,
  RunRepository,
  UsageEvidenceRepository,
  getSchemaVersion,
  migrate,
  openDatabase,
} from "../src/index.js";
import type { Db } from "../src/index.js";
import {
  buildContextPacketAccounting,
  calculateRunCostEvidence,
} from "@continuum/shared";

describe("context efficiency repositories", () => {
  let directory: string;
  let db: Db;
  let repositoryOne: number;
  let repositoryTwo: number;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "continuum-efficiency-"));
    db = openDatabase(join(directory, "continuum.db"));
    migrate(db);
    const repositories = new RepositoryRepository(db);
    repositoryOne = repositories.upsert(join(directory, "one"), "one").id;
    repositoryTwo = repositories.upsert(join(directory, "two"), "two").id;

    const runs = new RunRepository(db);
    runs.create({
      id: "run-one",
      repositoryId: repositoryOne,
      agentId: "fake",
      task: "fix timeout",
    });
    runs.create({
      id: "run-two",
      repositoryId: repositoryTwo,
      agentId: "fake",
      task: "other repository",
    });
  });

  afterEach(() => {
    db.close();
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });

  it("applies the current schema and versions pricing profiles append-only", () => {
    expect(getSchemaVersion(db)).toBe(6);
    const pricing = new PricingProfileRepository(db);
    pricing.set({
      provider: "continuum",
      model: "fake-1.0",
      version: "old",
      inputCreditsPerMillionTokens: 1,
      source: "user_configured",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    });
    const latest = pricing.set({
      provider: "continuum",
      model: "fake-1.0",
      version: "new",
      inputCreditsPerMillionTokens: 2,
      source: "user_configured",
      effectiveFrom: "2026-02-01T00:00:00.000Z",
    });

    expect(pricing.list()).toHaveLength(2);
    expect(pricing.findLatest("fake-1.0", "continuum")?.id).toBe(latest.id);
  });

  it("persists usage and evidence-labelled cost", () => {
    const pricing = new PricingProfileRepository(db).set({
      provider: "continuum",
      model: "fake-1.0",
      inputCreditsPerMillionTokens: 2,
      outputCreditsPerMillionTokens: 4,
      source: "user_configured",
    });
    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      measurement: "agent_reported" as const,
    };
    const usageRepository = new UsageEvidenceRepository(db);
    usageRepository.upsert({
      runId: "run-one",
      provider: "continuum",
      model: "fake-1.0",
      usage,
    });
    const cost = calculateRunCostEvidence("run-one", usage, pricing);
    const costs = new CostEvidenceRepository(db);
    costs.upsert(cost, pricing.id);

    expect(usageRepository.findByRunId("run-one")?.usage).toEqual(usage);
    expect(costs.findByRunId("run-one", usage)?.measurement).toBe("derived");
    expect(costs.findByRunId("run-one", usage)?.totalCredits).toBeCloseTo(0.0004);
  });

  it("suppresses exact and file-after-symbol duplicates and tracks presence", () => {
    const contexts = new ContextRepository(db);
    const symbol = contexts.upsertContextItem(
      repositoryOne,
      "symbol",
      "src/a.ts#handleTimeout",
    );
    contexts.insertContextItemVersion({
      id: "symbol-v1",
      context_item_id: symbol.id,
      content: "export function handleTimeout() { return 1; }",
      title: "handleTimeout",
      source_path: "src/a.ts",
      source_start_line: 1,
      source_end_line: 1,
      symbol_name: "handleTimeout",
      language: "typescript",
      content_hash: "symbol-hash",
      source_blob_hash: "blob",
      valid_from_commit: "abc",
      indexed_at: new Date().toISOString(),
      staleness_status: "current",
    });
    const file = contexts.upsertContextItem(repositoryOne, "file", "src/a.ts");
    contexts.insertContextItemVersion({
      id: "file-v1",
      context_item_id: file.id,
      content: "export function handleTimeout() { return 1; }\nexport const other = 2;",
      title: "src/a.ts",
      source_path: "src/a.ts",
      source_start_line: 1,
      source_end_line: 2,
      language: "typescript",
      content_hash: "file-hash",
      source_blob_hash: "blob",
      valid_from_commit: "abc",
      indexed_at: new Date().toISOString(),
      staleness_status: "current",
    });

    const ledger = new ContextLedgerRepository(db);
    const accounting = buildContextPacketAccounting({
      metadata: [],
      code: [],
      documentation: [],
      tests: [],
    });
    ledger.recordPacket({ id: "packet-one", runId: "run-one", accounting });

    const first = ledger.recordDelivery({
      runId: "run-one",
      packetId: "packet-one",
      contextItemVersionId: "symbol-v1",
      stage: "implementation",
      estimatedTokens: 16,
    });
    const duplicate = ledger.recordDelivery({
      runId: "run-one",
      packetId: "packet-one",
      contextItemVersionId: "symbol-v1",
      stage: "implementation",
      estimatedTokens: 16,
    });
    const fileDuplicate = ledger.recordDelivery({
      runId: "run-one",
      packetId: "packet-one",
      contextItemVersionId: "file-v1",
      stage: "escalation",
      estimatedTokens: 24,
    });

    expect(first.suppliedToAgent).toBe(true);
    expect(duplicate.reason).toBe("exact_duplicate_active");
    expect(duplicate.suppliedToAgent).toBe(false);
    expect(fileDuplicate.reason).toBe("equivalent_symbol_active");
    expect(fileDuplicate.suppliedToAgent).toBe(false);

    ledger.setPresence(first.delivery.deliveryId, "checkpointed", "checkpoint-1");
    const entries = ledger.findByRunId("run-one");
    expect(entries[0]?.presenceState).toBe("checkpointed");
    expect(entries[0]?.supersededByCheckpointId).toBe("checkpoint-1");
  });

  it("rejects cross-repository context deliveries", () => {
    const contexts = new ContextRepository(db);
    const item = contexts.upsertContextItem(repositoryOne, "symbol", "secret");
    contexts.insertContextItemVersion({
      id: "cross-v1",
      context_item_id: item.id,
      content: "secret",
      title: "secret",
      source_path: "secret.ts",
      source_start_line: 1,
      source_end_line: 1,
      language: "typescript",
      content_hash: "secret-hash",
      source_blob_hash: "blob",
      valid_from_commit: "abc",
      indexed_at: new Date().toISOString(),
      staleness_status: "current",
    });

    const ledger = new ContextLedgerRepository(db);
    ledger.recordPacket({
      id: "packet-two",
      runId: "run-two",
      accounting: buildContextPacketAccounting({
        metadata: [],
        code: [],
        documentation: [],
        tests: [],
      }),
    });

    expect(() =>
      ledger.recordDelivery({
        runId: "run-two",
        packetId: "packet-two",
        contextItemVersionId: "cross-v1",
        stage: "orientation",
        estimatedTokens: 2,
      }),
    ).toThrow(/different repositories/);
  });
});
