/**
 * Gemini CLI stream-json parser.
 *
 * Converts raw JSONL lines from `gemini -o stream-json` into normalised
 * AgentEvent objects.  The parser is defensive:
 *
 * 1. A raw line is always preserved regardless of parse outcome.
 * 2. Unknown event types emit UnknownAgentEvent — they are never discarded.
 * 3. Malformed JSON emits StdoutEvent with parse-error metadata.
 * 4. New Gemini fields that are not in our schemas are silently preserved
 *    in the raw payload (Zod passthrough() on known schemas).
 * 5. Token usage is only recorded when the adapter explicitly provides it.
 *
 * Observed Gemini CLI 0.50.0 stream-json event shapes (empirically derived):
 *
 *   {"type":"init","sessionId":"...","model":"..."}
 *   {"type":"content","text":"..."}  (agent message)
 *   {"type":"tool_call","name":"...","id":"...","input":{...}}
 *   {"type":"tool_result","id":"...","name":"...","output":"...","exitCode":0}
 *   {"type":"usage","inputTokens":N,"outputTokens":N,"cachedInputTokens":N}
 *   {"type":"result","exitCode":0}
 *   {"type":"error","message":"..."}
 *
 * This parser maps these to the Continuum neutral event union.
 * If Gemini changes a field name, unknown structure is preserved in raw.
 */

import { z } from "zod";
import {
  generateEventId,
  now,
  redactString,
  redactValue,
} from "@continuum/shared";
import type {
  AgentEvent,
  AgentInitEvent,
  AgentMessageEvent,
  ToolCallEvent,
  ToolResultEvent,
  TokenUsageEvent,
  StdoutEvent,
  StderrEvent,
  UnknownAgentEvent,
  AgentResultEvent,
  AgentErrorEvent,
  EventSource,
} from "@continuum/shared";

// ---------------------------------------------------------------------------
// Zod schemas for known Gemini event types — all use passthrough() so
// additional fields from newer CLI versions are not rejected.
// ---------------------------------------------------------------------------

const GeminiInitEvent = z
  .object({
    type: z.literal("init"),
    sessionId: z.string().optional(),
    model: z.string().optional(),
  })
  .passthrough();

const GeminiContentEvent = z
  .object({
    type: z.literal("content"),
    text: z.string(),
    role: z.string().optional(),
  })
  .passthrough();

const GeminiToolCallEvent = z
  .object({
    type: z.literal("tool_call"),
    name: z.string(),
    id: z.string().optional(),
    input: z.record(z.unknown()).optional(),
  })
  .passthrough();

const GeminiToolResultEvent = z
  .object({
    type: z.literal("tool_result"),
    id: z.string().optional(),
    name: z.string().optional(),
    output: z.string().optional(),
    exitCode: z.number().optional(),
  })
  .passthrough();

const GeminiUsageEvent = z
  .object({
    type: z.literal("usage"),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    cachedInputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
  })
  .passthrough();

const GeminiResultEvent = z
  .object({
    type: z.literal("result"),
    exitCode: z.number().optional(),
  })
  .passthrough();

const GeminiErrorEvent = z
  .object({
    type: z.literal("error"),
    message: z.string().optional(),
  })
  .passthrough();

// Discriminated union of known types
const KnownGeminiType = z.union([
  GeminiInitEvent,
  GeminiContentEvent,
  GeminiToolCallEvent,
  GeminiToolResultEvent,
  GeminiUsageEvent,
  GeminiResultEvent,
  GeminiErrorEvent,
]);

// ---------------------------------------------------------------------------
// Parser state passed through the parse call
// ---------------------------------------------------------------------------

interface ParseContext {
  runId: string;
  sequenceCounter: { value: number };
  redactPatterns: string[];
  captureRaw: boolean;
}

function nextSeq(ctx: ParseContext): number {
  ctx.sequenceCounter.value += 1;
  return ctx.sequenceCounter.value;
}

function makeHeader(
  ctx: ParseContext,
  source: EventSource,
  redacted: boolean,
) {
  return {
    eventId: generateEventId(),
    runId: ctx.runId,
    sequenceNumber: nextSeq(ctx),
    timestamp: now(),
    source,
    redactionApplied: redacted,
  };
}

/** Parse a single stdout line and return a normalised event. */
export function parseGeminiLine(
  rawLine: string,
  ctx: ParseContext,
  isStderr: boolean = false,
): AgentEvent {
  const redactedLine = redactString(rawLine, ctx.redactPatterns);
  const wasRedacted = redactedLine !== rawLine;
  const lineToStore = ctx.captureRaw ? redactedLine : "";

  // Attempt JSON parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(redactedLine);
  } catch (jsonErr) {
    // Not JSON — emit as raw stdout or stderr
    const evt: any = {
      ...makeHeader(ctx, isStderr ? "stderr" : "stdout", wasRedacted),
      eventType: isStderr ? "stderr" : "stdout",
      payload: {
        line: ctx.captureRaw ? redactedLine : undefined,
        parseError: jsonErr instanceof Error ? jsonErr.message : "JSON parse error",
      },
    };
    return evt;
  }

  // Not an object — treat as stdout/stderr
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const evt: any = {
      ...makeHeader(ctx, isStderr ? "stderr" : "stdout", wasRedacted),
      eventType: isStderr ? "stderr" : "stdout",
      payload: {
        line: ctx.captureRaw ? redactedLine : undefined,
        parseError: "Root JSON is not an object",
      },
    };
    return evt;
  }

  // Attempt to classify against known Gemini schemas
  const result = KnownGeminiType.safeParse(parsed);

  if (!result.success) {
    // Valid JSON but unknown or unrecognised structure
    const originalType =
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      typeof (parsed as Record<string, unknown>)["type"] === "string"
        ? String((parsed as Record<string, unknown>)["type"])
        : undefined;

    const evt: UnknownAgentEvent = {
      ...makeHeader(ctx, isStderr ? "stderr" : "stdout", wasRedacted),
      eventType: "unknown_agent_event",
      payload: {
        originalType,
        raw: ctx.captureRaw ? lineToStore : undefined,
        parseStatus: "partial",
      },
    };
    return evt;
  }

  const data = result.data;

  switch (data.type) {
    case "init": {
      const evt: AgentInitEvent = {
        ...makeHeader(ctx, "stdout", wasRedacted),
        eventType: "agent_init",
        payload: {
          sessionId: data.sessionId,
          model: data.model,
          raw: ctx.captureRaw ? lineToStore : undefined,
        },
      };
      return evt;
    }

    case "content": {
      const evt: AgentMessageEvent = {
        ...makeHeader(ctx, "stdout", wasRedacted),
        eventType: "agent_message",
        payload: {
          text: data.text,
          role: data.role,
          raw: ctx.captureRaw ? lineToStore : undefined,
        },
      };
      return evt;
    }

    case "tool_call": {
      const evt: ToolCallEvent = {
        ...makeHeader(ctx, "stdout", wasRedacted),
        eventType: "tool_call",
        payload: {
          toolName: data.name,
          toolCallId: data.id,
          input: ctx.captureRaw ? redactValue(data.input ?? {}, ctx.redactPatterns).value as Record<string, unknown> : (data.input ?? {}),
          raw: ctx.captureRaw ? lineToStore : undefined,
        },
      };
      return evt;
    }

    case "tool_result": {
      const evt: ToolResultEvent = {
        ...makeHeader(ctx, "stdout", wasRedacted),
        eventType: "tool_result",
        payload: {
          toolCallId: data.id,
          toolName: data.name,
          exitCode: data.exitCode,
          output: ctx.captureRaw && data.output ? redactValue(data.output, ctx.redactPatterns).value as string : undefined,
          raw: ctx.captureRaw ? lineToStore : undefined,
        },
      };
      return evt;
    }

    case "usage": {
      // Only record when at least one token field is present.
      if (
        data.inputTokens === undefined &&
        data.outputTokens === undefined &&
        data.cachedInputTokens === undefined
      ) {
        const evt: UnknownAgentEvent = {
          ...makeHeader(ctx, "stdout", wasRedacted),
          eventType: "unknown_agent_event",
          payload: { originalType: "usage", raw: ctx.captureRaw ? lineToStore : undefined, parseStatus: "partial" },
        };
        return evt;
      }
      const evt: TokenUsageEvent = {
        ...makeHeader(ctx, "stdout", wasRedacted),
        eventType: "token_usage",
        payload: {
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          cachedTokens: data.cachedInputTokens,
          totalTokens: data.totalTokens,
          raw: ctx.captureRaw ? lineToStore : undefined,
        },
      };
      return evt;
    }

    case "result": {
      const evt: AgentResultEvent = {
        ...makeHeader(ctx, "stdout", wasRedacted),
        eventType: "agent_result",
        payload: {
          exitCode: data.exitCode ?? 0,
          raw: ctx.captureRaw ? lineToStore : undefined,
        },
      };
      return evt;
    }

    case "error": {
      const evt: AgentErrorEvent = {
        ...makeHeader(ctx, "stdout", wasRedacted),
        eventType: "agent_error",
        payload: {
          reason: data.message ?? "Unknown Gemini error",
          raw: ctx.captureRaw ? lineToStore : undefined,
        },
      };
      return evt;
    }
  }
}

/** Parse a stderr line into a StderrEvent. */
export function parseStderrLine(rawLine: string, ctx: ParseContext): StderrEvent {
  const redacted = redactString(rawLine, ctx.redactPatterns);
  return {
    ...makeHeader(ctx, "stderr", redacted !== rawLine),
    eventType: "stderr",
    payload: { line: redacted },
  };
}

/** Create a ParseContext for use in tests or the adapter. */
export function createParseContext(
  runId: string,
  redactPatterns: string[] = [],
  captureRaw = true,
): ParseContext {
  return {
    runId,
    sequenceCounter: { value: 0 },
    redactPatterns,
    captureRaw,
  };
}
