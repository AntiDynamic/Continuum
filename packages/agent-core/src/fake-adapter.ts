/**
 * Fake agent adapter for use in automated tests.
 *
 * The fake adapter does not spawn any process.  Instead it emits a
 * configurable sequence of events synchronously, which allows tests to
 * verify orchestration logic, event persistence, and report generation
 * without network access or a real agent installation.
 *
 * Design: The test author specifies the events to emit via `FakeAdapterConfig`.
 * This covers all important scenarios:
 *   - Successful run with tool calls
 *   - Token usage reporting
 *   - Cancellation mid-run
 *   - Timeout
 *   - Error / failure
 */

import {
  generateEventId,
  now,
} from "@continuum/shared";
import type {
  AgentAdapter,
  AgentAvailability,
  AgentCapabilities,
  AgentRunInput,
  AgentEvent,
} from "@continuum/shared";

export interface FakeAdapterConfig {
  /** Events to emit after run_started. */
  events: AgentEvent[];
  /** Whether the adapter should report as available. */
  available?: boolean;
  /** Delay between events in milliseconds (default 0). */
  eventDelayMs?: number;
}

export class FakeAdapter implements AgentAdapter {
  readonly id = "fake";
  readonly displayName = "Fake Agent (Testing)";

  constructor(private readonly config: FakeAdapterConfig) {}

  async detectAvailability(): Promise<AgentAvailability> {
    return {
      available: this.config.available !== false,
      version: "0.0.0-fake",
      executablePath: "/fake/agent",
    };
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    return {
      structuredOutput: true,
      streamingOutput: true,
      tokenUsage: true,
      toolEvents: true,
      sessionId: true,
      cancellation: true,
    };
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    let seq = 0;

    // Emit run_started
    yield {
      eventId: generateEventId(),
      runId: input.runId,
      sequenceNumber: seq++,
      timestamp: now(),
      source: "system",
      redactionApplied: false,
      eventType: "run_started",
      payload: {
        command: "/fake/agent --prompt ...",
        args: ["--prompt", input.task],
        outputMode: "stream-json",
      },
    };

    for (const event of this.config.events) {
      if (input.signal?.aborted) {
        yield {
          eventId: generateEventId(),
          runId: input.runId,
          sequenceNumber: seq++,
          timestamp: now(),
          source: "system",
          redactionApplied: false,
          eventType: "run_failed",
          payload: {
            reason: "Cancelled by signal",
            durationMs: 0,
            timedOut: false,
            cancelled: true,
          },
        };
        return;
      }

      if (this.config.eventDelayMs && this.config.eventDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.config.eventDelayMs),
        );
      }

      yield { ...event, runId: input.runId, sequenceNumber: seq++ };
    }
  }

  async cancel(_runId: string): Promise<void> {
    // No-op for fake adapter — cancellation is handled via AbortSignal
  }
}

/** Build a minimal successful fake run event sequence. */
export function buildFakeSuccessEvents(runId: string): AgentEvent[] {
  const base = {
    runId,
    source: "stdout" as const,
    redactionApplied: false,
    timestamp: now(),
  };

  return [
    {
      ...base,
      eventId: generateEventId(),
      sequenceNumber: 1,
      eventType: "agent_init",
      payload: { sessionId: "fake-session-001", model: "fake-1.0", raw: "" },
    },
    {
      ...base,
      eventId: generateEventId(),
      sequenceNumber: 2,
      eventType: "agent_message",
      payload: { text: "I will fix the failing test.", raw: "" },
    },
    {
      ...base,
      eventId: generateEventId(),
      sequenceNumber: 3,
      eventType: "tool_call",
      payload: {
        toolName: "read_file",
        toolCallId: "tc-001",
        input: { path: "src/calculator.ts" },
        raw: "",
      },
    },
    {
      ...base,
      eventId: generateEventId(),
      sequenceNumber: 4,
      eventType: "tool_result",
      payload: {
        toolCallId: "tc-001",
        toolName: "read_file",
        exitCode: 0,
        output: "function factorial(n) { ... }",
        raw: "",
      },
    },
    {
      ...base,
      eventId: generateEventId(),
      sequenceNumber: 5,
      eventType: "agent_message",
      payload: { text: "Fixed the base case.", raw: "" },
    },
    {
      ...base,
      eventId: generateEventId(),
      sequenceNumber: 6,
      eventType: "token_usage",
      payload: {
        inputTokens: 300,
        outputTokens: 80,
        cachedTokens: 0,
        raw: "",
      },
    },
    {
      ...base,
      source: "system" as const,
      eventId: generateEventId(),
      sequenceNumber: 7,
      eventType: "run_completed",
      payload: { exitCode: 0, durationMs: 4200 },
    },
  ] satisfies AgentEvent[];
}
