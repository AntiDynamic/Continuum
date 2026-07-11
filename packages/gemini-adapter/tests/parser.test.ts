import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGeminiLine, createParseContext } from "../src/parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

function makeCtx() {
  return createParseContext("test-run-001");
}

function parseFixture(filename: string): ReturnType<typeof parseGeminiLine>[] {
  const content = readFileSync(join(fixturesDir, filename), "utf-8");
  const ctx = makeCtx();
  return content
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => parseGeminiLine(line, ctx));
}

describe("parseGeminiLine — init event", () => {
  it("parses init event correctly", () => {
    const ctx = makeCtx();
    const event = parseGeminiLine(
      '{"type":"init","sessionId":"sess-1","model":"gemini-2.5-pro"}',
      ctx,
    );
    expect(event.eventType).toBe("agent_init");
    if (event.eventType === "agent_init") {
      expect(event.payload.sessionId).toBe("sess-1");
      expect(event.payload.model).toBe("gemini-2.5-pro");
    }
  });
});

describe("parseGeminiLine — content/message event", () => {
  it("parses agent message", () => {
    const ctx = makeCtx();
    const event = parseGeminiLine(
      '{"type":"content","text":"Hello world","role":"assistant"}',
      ctx,
    );
    expect(event.eventType).toBe("agent_message");
    if (event.eventType === "agent_message") {
      expect(event.payload.text).toBe("Hello world");
    }
  });
});

describe("parseGeminiLine — tool_call event", () => {
  it("parses tool call with input", () => {
    const ctx = makeCtx();
    const event = parseGeminiLine(
      '{"type":"tool_call","name":"read_file","id":"tc-1","input":{"path":"src/calc.ts"}}',
      ctx,
    );
    expect(event.eventType).toBe("tool_call");
    if (event.eventType === "tool_call") {
      expect(event.payload.toolName).toBe("read_file");
      expect(event.payload.toolCallId).toBe("tc-1");
      expect(event.payload.input["path"]).toBe("src/calc.ts");
    }
  });
});

describe("parseGeminiLine — tool_result event", () => {
  it("parses tool result", () => {
    const ctx = makeCtx();
    const event = parseGeminiLine(
      '{"type":"tool_result","id":"tc-1","name":"read_file","output":"content","exitCode":0}',
      ctx,
    );
    expect(event.eventType).toBe("tool_result");
    if (event.eventType === "tool_result") {
      expect(event.payload.exitCode).toBe(0);
    }
  });
});

describe("parseGeminiLine — usage event", () => {
  it("parses token usage", () => {
    const ctx = makeCtx();
    const event = parseGeminiLine(
      '{"type":"usage","inputTokens":450,"outputTokens":120,"cachedInputTokens":0}',
      ctx,
    );
    expect(event.eventType).toBe("token_usage");
    if (event.eventType === "token_usage") {
      expect(event.payload.inputTokens).toBe(450);
      expect(event.payload.outputTokens).toBe(120);
      expect(event.payload.cachedTokens).toBe(0);
    }
  });

  it("does not fabricate token usage for empty usage event", () => {
    const ctx = makeCtx();
    const event = parseGeminiLine('{"type":"usage"}', ctx);
    // Should not emit token_usage with undefined counts — emits unknown instead
    expect(event.eventType).toBe("unknown_agent_event");
  });
});

describe("parseGeminiLine — result event", () => {
  it("parses successful result", () => {
    const ctx = makeCtx();
    const event = parseGeminiLine('{"type":"result","exitCode":0}', ctx);
    expect(event.eventType).toBe("run_completed");
    if (event.eventType === "run_completed") {
      expect(event.payload.exitCode).toBe(0);
    }
  });
});

describe("parseGeminiLine — error event", () => {
  it("parses error event", () => {
    const ctx = makeCtx();
    const event = parseGeminiLine(
      '{"type":"error","message":"Quota exceeded"}',
      ctx,
    );
    expect(event.eventType).toBe("run_failed");
    if (event.eventType === "run_failed") {
      expect(event.payload.reason).toBe("Quota exceeded");
    }
  });
});

describe("parseGeminiLine — malformed input", () => {
  it("returns stdout event for non-JSON line", () => {
    const ctx = makeCtx();
    const event = parseGeminiLine("This is plain text output", ctx);
    expect(event.eventType).toBe("stdout");
    if (event.eventType === "stdout") {
      expect(event.payload.parseError).toBeDefined();
    }
  });

  it("preserves unknown JSON event types as unknown_agent_event", () => {
    const ctx = makeCtx();
    const event = parseGeminiLine(
      '{"type":"future_event_type_v2","someNewField":"value"}',
      ctx,
    );
    expect(event.eventType).toBe("unknown_agent_event");
    if (event.eventType === "unknown_agent_event") {
      expect(event.payload.originalType).toBe("future_event_type_v2");
    }
  });

  it("does not throw on JSON without a type field", () => {
    const ctx = makeCtx();
    expect(() =>
      parseGeminiLine('{"totally":"invalid","no_type_field":true}', ctx),
    ).not.toThrow();
  });
});

describe("parseGeminiLine — sequence numbers", () => {
  it("increments sequence numbers monotonically", () => {
    const ctx = makeCtx();
    const e1 = parseGeminiLine('{"type":"content","text":"a"}', ctx);
    const e2 = parseGeminiLine('{"type":"content","text":"b"}', ctx);
    expect(e2.sequenceNumber).toBeGreaterThan(e1.sequenceNumber);
  });
});

describe("parseGeminiLine — redaction", () => {
  it("redacts API keys from content before storing raw", () => {
    const ctx = createParseContext("run-x", [], true);
    const event = parseGeminiLine(
      '{"type":"content","text":"Key is AIzaSyAbcdefghijklmnopqrstuvwxyz01234567"}',
      ctx,
    );
    if (event.eventType === "agent_message") {
      expect(event.payload.text).not.toContain("AIzaSy");
    }
  });
});

describe("fixture: successful-run.jsonl", () => {
  it("parses all lines without throwing", () => {
    const events = parseFixture("successful-run.jsonl");
    expect(events.length).toBeGreaterThan(5);
  });

  it("contains init, tool_call, tool_result, token_usage, and run_completed", () => {
    const events = parseFixture("successful-run.jsonl");
    const types = new Set(events.map((e) => e.eventType));
    expect(types.has("agent_init")).toBe(true);
    expect(types.has("tool_call")).toBe(true);
    expect(types.has("tool_result")).toBe(true);
    expect(types.has("token_usage")).toBe(true);
    expect(types.has("run_completed")).toBe(true);
  });
});

describe("fixture: malformed-lines.jsonl", () => {
  it("does not throw on malformed lines", () => {
    expect(() => parseFixture("malformed-lines.jsonl")).not.toThrow();
  });

  it("emits stdout events for non-JSON lines", () => {
    const events = parseFixture("malformed-lines.jsonl");
    const stdoutEvents = events.filter((e) => e.eventType === "stdout");
    expect(stdoutEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("emits unknown_agent_event for JSON with no type", () => {
    const events = parseFixture("malformed-lines.jsonl");
    const unknownEvents = events.filter(
      (e) => e.eventType === "unknown_agent_event",
    );
    expect(unknownEvents.length).toBeGreaterThanOrEqual(1);
  });
});

describe("fixture: unknown-events.jsonl", () => {
  it("preserves unknown event type without discarding", () => {
    const events = parseFixture("unknown-events.jsonl");
    const unknown = events.filter(
      (e) => e.eventType === "unknown_agent_event",
    );
    expect(unknown.length).toBeGreaterThanOrEqual(1);
    const first = unknown[0];
    if (first?.eventType === "unknown_agent_event") {
      expect(first.payload.originalType).toBe("future_event_type_v2");
    }
  });
});

describe("fixture: error-run.jsonl", () => {
  it("parses error event as run_failed", () => {
    const events = parseFixture("error-run.jsonl");
    const failed = events.find((e) => e.eventType === "run_failed");
    expect(failed).toBeDefined();
    if (failed?.eventType === "run_failed") {
      expect(failed.payload.reason).toContain("quota");
    }
  });
});
