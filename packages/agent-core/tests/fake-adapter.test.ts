import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDatabase, migrate } from "@continuum/database";
import type { Db } from "@continuum/database";
import { FakeAdapter, buildFakeSuccessEvents } from "../src/fake-adapter.js";

let tmpDir: string;
let db: Db;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "continuum-core-test-"));
  db = openDatabase(join(tmpDir, "test.db"));
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("FakeAdapter", () => {
  it("reports as available", async () => {
    const adapter = new FakeAdapter({ events: [] });
    const availability = await adapter.detectAvailability();
    expect(availability.available).toBe(true);
    expect(availability.version).toBe("0.0.0-fake");
  });

  it("reports as unavailable when configured", async () => {
    const adapter = new FakeAdapter({ events: [], available: false });
    const availability = await adapter.detectAvailability();
    expect(availability.available).toBe(false);
  });

  it("emits run_started followed by configured events", async () => {
    const successEvents = buildFakeSuccessEvents("test-run-x");
    const adapter = new FakeAdapter({ events: successEvents });

    const emitted = [];
    for await (const event of adapter.run({
      runId: "test-run-x",
      task: "Fix the test",
      repositoryPath: tmpDir,
      workingDirectory: tmpDir,
    })) {
      emitted.push(event);
    }

    expect(emitted[0]?.eventType).toBe("run_started");
    const types = emitted.map((e) => e.eventType);
    expect(types).toContain("agent_init");
    expect(types).toContain("tool_call");
    expect(types).toContain("token_usage");
    expect(types).toContain("run_completed");
  });

  it("stops emitting when signal is aborted", async () => {
    const controller = new AbortController();
    const successEvents = buildFakeSuccessEvents("test-run-cancel");

    // Abort immediately
    controller.abort();

    const adapter = new FakeAdapter({ events: successEvents });
    const emitted = [];
    for await (const event of adapter.run({
      runId: "test-run-cancel",
      task: "Fix the test",
      repositoryPath: tmpDir,
      workingDirectory: tmpDir,
      signal: controller.signal,
    })) {
      emitted.push(event);
    }

    const lastEvent = emitted[emitted.length - 1];
    expect(lastEvent?.eventType).toBe("run_failed");
    if (lastEvent?.eventType === "run_failed") {
      expect(lastEvent.payload.cancelled).toBe(true);
    }
  });

  it("has all events with the same runId", async () => {
    const runId = "consistency-check";
    const adapter = new FakeAdapter({
      events: buildFakeSuccessEvents(runId),
    });
    const emitted = [];
    for await (const event of adapter.run({
      runId,
      task: "test",
      repositoryPath: tmpDir,
      workingDirectory: tmpDir,
    })) {
      emitted.push(event);
    }
    for (const event of emitted) {
      expect(event.runId).toBe(runId);
    }
  });

  it("emits monotonically increasing sequence numbers", async () => {
    const runId = "seq-check";
    const adapter = new FakeAdapter({
      events: buildFakeSuccessEvents(runId),
    });
    const emitted = [];
    for await (const event of adapter.run({
      runId,
      task: "test",
      repositoryPath: tmpDir,
      workingDirectory: tmpDir,
    })) {
      emitted.push(event);
    }
    for (let i = 1; i < emitted.length; i++) {
      const prev = emitted[i - 1];
      const curr = emitted[i];
      if (prev && curr) {
        expect(curr.sequenceNumber).toBeGreaterThan(prev.sequenceNumber);
      }
    }
  });
});
