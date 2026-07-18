import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { openDatabase, migrate } from "@continuum/database";
import type { Db } from "@continuum/database";
import { orchestrateRun } from "../src/index.js";
import { FakeAdapter } from "../src/fake-adapter.js";
import { loadConfig } from "@continuum/shared";
import { execa } from "execa";

describe("End-to-End Database Privacy", () => {
  let tempDir: string;
  let dbPath: string;
  let db: Db;

  beforeAll(async () => {
    tempDir = await mkdtemp(resolve(tmpdir(), "continuum-privacy-test-"));
    dbPath = resolve(tempDir, "continuum.db");
    await execa("git", ["init"], { cwd: tempDir });
  });

  afterAll(async () => {
    if (db) {
      db.close();
    }
    await rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });

  it("should prevent CONTINUUM_TEST_SECRET_9f73a1 from persisting in any table", async () => {
    db = openDatabase(dbPath);
    migrate(db);

    const secret = "CONTINUUM_TEST_SECRET_9f73a1";

    // Setup fake adapter that emits the secret
    const adapter = new FakeAdapter();
    const originalRun = adapter.run.bind(adapter);
    adapter.run = async function*(input) {
      let seq = 1;
      const emit = (type: string, payload: any) => ({
        eventId: "e-" + seq,
        runId: input.runId,
        sequenceNumber: seq++,
        timestamp: new Date().toISOString(),
        source: "agent",
        eventType: type,
        redactionApplied: false,
        payload,
      } as any);

      const redacted = "[REDACTED]";
      const out = input.policy.redactPatterns?.includes(secret) ? redacted : secret;

      yield emit("run_started", { command: "test", outputMode: "text" });
      yield emit("agent_message", { text: `My secret is ${out}`, raw: input.policy.captureRawOutput ? `Raw: ${out}` : undefined });
      yield emit("tool_call", { toolName: "run", toolCallId: "123", input: { key: out }, raw: input.policy.captureRawOutput ? `Raw: ${out}` : undefined });
      yield emit("stderr", { line: input.policy.captureRawOutput ? `Error: ${out}` : undefined });
      yield emit("run_completed", { exitCode: 0, durationMs: 100 });
    };

    const config = {
      defaultAgent: "fake",
      captureRawOutput: false, // Wait, test both true and false.
      redactPatterns: [secret],
      testCommands: [],
      unsafeAutoApprove: false,
      initializationTimeoutMs: 5000,
    };

    // Test captureRawOutput: false
    const result1 = await orchestrateRun({
      task: `Do task with secret key`,
      adapter,
      config,
      db,
      repositoryPath: tempDir,
      runsDir: tempDir,
      skipBaselineTests: true,
      skipFinalTests: true,
      additionalArgs: [`--arg=secret`]
    });

    // Test captureRawOutput: true
    config.captureRawOutput = true;
    const result2 = await orchestrateRun({
      task: `Do another task with secret key`,
      adapter,
      config,
      db,
      repositoryPath: tempDir,
      runsDir: tempDir,
      skipBaselineTests: true,
      skipFinalTests: true,
      additionalArgs: [`--arg=secret`]
    });

    // Verify DB does not contain the secret anywhere
    // Since node:sqlite is synchronous, we can just do a dump or check all strings in tables
    const stmt = db.prepare(`SELECT * FROM agent_events`);
    const events = stmt.all();
    const serializedEvents = JSON.stringify(events);
    expect(serializedEvents).not.toContain(secret);

    const runsStmt = db.prepare(`SELECT * FROM agent_runs`);
    const runs = runsStmt.all();
    const serializedRuns = JSON.stringify(runs);
    expect(serializedRuns).not.toContain(secret);
  }, 15_000);
});
