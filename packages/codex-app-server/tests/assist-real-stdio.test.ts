import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { initializeAndRunProductionIndex } from "@continuum/repository-indexer";
import { migrate, openDatabase } from "@continuum/database";
import { CodexAssistExecutionService } from "../src/assist-execution-service.js";
import { parseAssistContextToolResult } from "../src/assist-tool-result.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("assist native tools over real JSONL stdio", () => {
  it("links raw requests and responses and records structured results, signals, and refusals", async () => {
    const repository = await mkdtemp(join(tmpdir(), "continuum-assist-stdio-"));
    created.push(repository);
    await writeFile(join(repository, ".gitignore"), ".continuum/\n", "utf8");
    await writeFile(join(repository, "add.ts"), "export const add = (a:number,b:number) => a+b;\n", "utf8");
    await writeFile(join(repository, "rare.ts"), "export function rareImplementation(){ return 42; }\n", "utf8");
    await writeFile(join(repository, "add.test.ts"), "import {add} from './add.js';\n// tests\n", "utf8");
    execFileSync("git", ["init"], { cwd: repository });
    execFileSync("git", ["config", "user.email", "continuum@example.test"], { cwd: repository });
    execFileSync("git", ["config", "user.name", "Continuum Fixture"], { cwd: repository });
    execFileSync("git", ["add", "."], { cwd: repository });
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: repository });
    await initializeAndRunProductionIndex(repository);
    const fixture = fileURLToPath(new URL("./fixtures/fake-app-server.mjs", import.meta.url));
    const result = await new CodexAssistExecutionService().runAssist({
      cwd: repository,
      task: "change add and verify tests",
      maxContextToolCalls: 20,
      maxContextResultTokens: 1500,
      sessionBudget: 6000,
      process: {
        executable: process.execPath,
        executableArgs: [fixture],
        env: { ...process.env, FAKE_CODEX_SCENARIO: "assist-tools" },
      },
      codexVersionOverride: "fixture",
    });
    expect(result.report.initialContext.schema).toBe("continuum.assist-context.v1");
    expect(result.report.nativeToolActivity.requested).toBeGreaterThanOrEqual(8);
    expect(result.report.contextSignals.count).toBeGreaterThanOrEqual(3);
    expect(result.report.nativeToolActivity.refused).toBeGreaterThanOrEqual(4);

    const db = openDatabase(join(repository, ".continuum", "continuum.db"));
    migrate(db);
    try {
      const events = db.prepare(`
        SELECT call_id,event_type,raw_sequence_number,result_json,failure_code
        FROM codex_assist_tool_call_events_v2
        WHERE execution_id=?
        ORDER BY created_at,rowid
      `).all(result.executionId) as Array<{
        call_id: string; event_type: string; raw_sequence_number: number | null;
        result_json: string | null; failure_code: string | null;
      }>;
      const responses = events.filter((event) => event.event_type === "response_sent");
      expect(responses).toHaveLength(12);
      for (const response of responses) {
        const request = events.find((event) =>
          event.call_id === response.call_id &&
          (event.event_type === "requested" || event.event_type === "signal_received"));
        expect(request?.raw_sequence_number).not.toBeNull();
        expect(response.raw_sequence_number).not.toBeNull();
        expect(response.raw_sequence_number).not.toBe(request?.raw_sequence_number);
      }
      const contextResponses = responses.filter((event) => event.call_id.startsWith("context-"));
      const parsed = contextResponses.map((event) => { try { return parseAssistContextToolResult(event.result_json!); } catch (error) { throw new Error(`Invalid result for ${event.call_id}: ${event.result_json}`, { cause: error }); } });
      expect(parsed[0]?.newItems.length).toBeGreaterThan(0);
      expect(parsed[1]?.references.length).toBeGreaterThan(0);
      expect(parsed[2]?.references.length).toBeGreaterThan(0);
      expect(events.some((event) => event.failure_code === "INVALID_NAMESPACE")).toBe(true);
      expect(events.some((event) => event.failure_code === "INVALID_CALL_ID")).toBe(true);
      expect(events.some((event) => event.failure_code === "INVALID_THREAD")).toBe(true);
      expect(events.some((event) => event.failure_code === "INVALID_TURN")).toBe(true);
      expect(events.some((event) => event.failure_code === "INVALID_ARGUMENTS")).toBe(true);
      const raw = db.prepare(
        "SELECT raw_json FROM codex_raw_events WHERE execution_id=? AND direction='client_to_server'",
      ).all(result.executionId) as Array<{ raw_json: string }>;
      const threadStart = raw.map((row) => JSON.parse(row.raw_json) as Record<string, unknown>)
        .find((message) => message["method"] === "thread/start") as { params: { dynamicTools: unknown[] } };
      const turnStart = raw.map((row) => JSON.parse(row.raw_json) as Record<string, unknown>)
        .find((message) => message["method"] === "turn/start") as { params: { input: unknown[] } };
      expect(threadStart.params.dynamicTools).toHaveLength(2);
      expect(turnStart.params.input).toHaveLength(2);
    } finally {
      db.close();
    }
    const resultLimited = await new CodexAssistExecutionService().runAssist({
      cwd: repository, task: "result limit", maxContextToolCalls: 20, maxContextResultTokens: 5, sessionBudget: 6000,
      process: { executable: process.execPath, executableArgs: [fixture], env: { ...process.env, FAKE_CODEX_SCENARIO: "assist-tools" } }, codexVersionOverride: "fixture",
    });
    const sessionLimited = await new CodexAssistExecutionService().runAssist({
      cwd: repository, task: "session limit", maxContextToolCalls: 20, maxContextResultTokens: 1500, sessionBudget: 30,
      process: { executable: process.execPath, executableArgs: [fixture], env: { ...process.env, FAKE_CODEX_SCENARIO: "assist-tools" } }, codexVersionOverride: "fixture",
    });
    const limitsDb=openDatabase(join(repository,".continuum","continuum.db"));
    try {
      expect((limitsDb.prepare("SELECT COUNT(*) n FROM codex_assist_tool_call_events_v2 WHERE execution_id=? AND event_type='refused' AND failure_code='RESULT_TOKEN_LIMIT'").get(resultLimited.executionId) as {n:number}).n).toBeGreaterThan(0);
      expect((limitsDb.prepare("SELECT COUNT(*) n FROM codex_assist_tool_call_events_v2 WHERE execution_id=? AND event_type='refused' AND failure_code='SESSION_TOKEN_LIMIT'").get(sessionLimited.executionId) as {n:number}).n).toBeGreaterThan(0);
      const session=limitsDb.prepare("SELECT delivered_estimated_tokens,maximum_estimated_tokens FROM context_sessions WHERE id=?").get(sessionLimited.sessionId) as {delivered_estimated_tokens:number;maximum_estimated_tokens:number};
      expect(session.delivered_estimated_tokens).toBeLessThanOrEqual(session.maximum_estimated_tokens);
    } finally { limitsDb.close(); }
  }, 90_000);
});
