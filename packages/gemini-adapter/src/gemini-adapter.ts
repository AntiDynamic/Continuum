/**
 * Gemini CLI adapter.
 *
 * Implements the AgentAdapter interface for Gemini CLI 0.50.0.
 * Before assuming CLI flags, the constructor inspects the actual installed
 * help output via `gemini --help`.
 *
 * Output mode preference order:
 *   1. stream-json (JSONL, preferred — richest event data)
 *   2. json        (single JSON object at the end)
 *   3. text        (plain stdout capture)
 */

import { execa } from "execa";
import { createReadlineInterface } from "./readline-helper.js";
import { parseGeminiLine, parseStderrLine, createParseContext } from "./parser.js";
import {
  AgentNotFoundError,
  generateEventId,
  now,
  createLogger,
} from "@continuum/shared";
import type {
  AgentAdapter,
  AgentAvailability,
  AgentCapabilities,
  AgentRunInput,
  AgentEvent,
  RunStartedEvent,
  RunCompletedEvent,
  RunFailedEvent,
} from "@continuum/shared";

const log = createLogger("gemini-adapter");

const GEMINI_EXECUTABLE = "gemini";

export class GeminiAdapter implements AgentAdapter {
  readonly id = "gemini";
  readonly displayName = "Gemini CLI";

  private readonly pendingCancellations = new Map<string, () => void>();

  async detectAvailability(): Promise<AgentAvailability> {
    try {
      const result = await execa(GEMINI_EXECUTABLE, ["--version"], {
        reject: false,
        timeout: 10_000,
      });

      if (result.exitCode !== 0 && !result.stdout) {
        return {
          available: false,
          reason: `gemini --version exited with code ${String(result.exitCode)}`,
        };
      }

      const version = result.stdout.trim() || result.stderr.trim();

      // Resolve actual executable path
      const whichResult = await execa("where", ["gemini"], {
        reject: false,
      }).catch(() => ({ stdout: "" }));
      const executablePath = whichResult.stdout.split("\n")[0]?.trim();

      return {
        available: true,
        version,
        executablePath,
      };
    } catch (err) {
      return {
        available: false,
        reason:
          err instanceof Error
            ? err.message
            : "gemini command not found",
      };
    }
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    // Inspect the actual help output to detect supported output modes
    let helpOutput = "";
    try {
      const result = await execa(GEMINI_EXECUTABLE, ["--help"], {
        reject: false,
        timeout: 10_000,
      });
      helpOutput = result.stdout + result.stderr;
    } catch {
      // Cannot inspect help — assume minimal capabilities
    }

    const hasStreamJson =
      helpOutput.includes("stream-json") || helpOutput.includes("stream_json");
    const hasJson = helpOutput.includes('"json"') || helpOutput.includes("json");
    const hasStructured = hasStreamJson || hasJson;

    log.debug("Detected capabilities from help output", {
      hasStreamJson,
      hasJson,
    });

    return {
      structuredOutput: hasStructured,
      streamingOutput: hasStreamJson,
      // Token usage appears in the "usage" event type — reported when present
      tokenUsage: hasStreamJson,
      // Tool events appear in stream-json mode
      toolEvents: hasStreamJson,
      // Session ID is reported in the "init" event
      sessionId: hasStreamJson,
      cancellation: true,
    };
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const availability = await this.detectAvailability();
    if (!availability.available) {
      throw new AgentNotFoundError("gemini");
    }

    const capabilities = await this.getCapabilities();
    const outputMode = capabilities.streamingOutput
      ? "stream-json"
      : capabilities.structuredOutput
        ? "json"
        : "text";

    log.info("Starting Gemini CLI run", {
      runId: input.runId,
      outputMode,
      task: input.task.slice(0, 80),
    });

    const args = [
      "--prompt",
      input.task,
      "--output-format",
      outputMode,
      // Auto-approve tool executions so the agent can complete unattended
      "--yolo",
      // Trust the repository workspace
      "--skip-trust",
      ...(input.additionalArgs ?? []),
    ];

    const exactCommand = `${GEMINI_EXECUTABLE} ${args.map((a) => JSON.stringify(a)).join(" ")}`;

    const ctx = createParseContext(input.runId);
    const startTime = Date.now();

    // Emit run_started event
    const startedEvent: RunStartedEvent = {
      eventId: generateEventId(),
      runId: input.runId,
      sequenceNumber: 0,
      timestamp: now(),
      source: "system",
      redactionApplied: false,
      eventType: "run_started",
      payload: {
        command: exactCommand,
        args,
        outputMode,
      },
    };
    yield startedEvent;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let child: any;

    try {
      const execaOptions: Record<string, any> = {
        cwd: input.workingDirectory,
        reject: false,
        all: false,
        stdout: "pipe",
        stderr: "pipe",
      };
      if (input.timeoutMs !== undefined) {
        execaOptions["timeout"] = input.timeoutMs;
      }

      child = execa(GEMINI_EXECUTABLE, args, execaOptions);

      // Register cancellation callback
      if (child.pid !== undefined) {
        this.pendingCancellations.set(input.runId, () => {
          child?.kill("SIGTERM");
        });
      }

      // Propagate external AbortSignal
      if (input.signal) {
        input.signal.addEventListener("abort", () => {
          child?.kill("SIGTERM");
        });
      }

      const events: AgentEvent[] = [];

      // Process stdout line by line
      if (child.stdout) {
        const stdoutRl = createReadlineInterface(child.stdout);
        for await (const line of stdoutRl) {
          if (!line.trim()) continue;
          const event = parseGeminiLine(line, ctx);
          events.push(event);
          yield event;
        }
      }

      // Collect stderr
      if (child.stderr) {
        const stderrRl = createReadlineInterface(child.stderr);
        for await (const line of stderrRl) {
          if (!line.trim()) continue;
          const event = parseStderrLine(line, ctx);
          events.push(event);
          yield event;
        }
      }

      // Wait for process exit
      const result = await child;
      const durationMs = Date.now() - startTime;

      this.pendingCancellations.delete(input.runId);

      if (result.timedOut) {
        const failedEvent: RunFailedEvent = {
          eventId: generateEventId(),
          runId: input.runId,
          sequenceNumber: ctx.sequenceCounter.value + 1,
          timestamp: now(),
          source: "system",
          redactionApplied: false,
          eventType: "run_failed",
          payload: {
            exitCode: result.exitCode ?? undefined,
            reason: `Gemini CLI timed out after ${String(input.timeoutMs ?? "unknown")}ms`,
            durationMs,
            timedOut: true,
            cancelled: false,
          },
        };
        yield failedEvent;
        return;
      }

      if (result.isCanceled) {
        const failedEvent: RunFailedEvent = {
          eventId: generateEventId(),
          runId: input.runId,
          sequenceNumber: ctx.sequenceCounter.value + 1,
          timestamp: now(),
          source: "system",
          redactionApplied: false,
          eventType: "run_failed",
          payload: {
            reason: "Cancelled by user",
            durationMs,
            timedOut: false,
            cancelled: true,
          },
        };
        yield failedEvent;
        return;
      }

      const completedEvent: RunCompletedEvent = {
        eventId: generateEventId(),
        runId: input.runId,
        sequenceNumber: ctx.sequenceCounter.value + 1,
        timestamp: now(),
        source: "system",
        redactionApplied: false,
        eventType: "run_completed",
        payload: {
          exitCode: result.exitCode ?? 0,
          durationMs,
        },
      };
      yield completedEvent;
    } catch (err) {
      this.pendingCancellations.delete(input.runId);
      const durationMs = Date.now() - startTime;
      const failedEvent: RunFailedEvent = {
        eventId: generateEventId(),
        runId: input.runId,
        sequenceNumber: ctx.sequenceCounter.value + 1,
        timestamp: now(),
        source: "system",
        redactionApplied: false,
        eventType: "run_failed",
        payload: {
          reason: err instanceof Error ? err.message : "Unknown error",
          durationMs,
          timedOut: false,
          cancelled: false,
        },
      };
      yield failedEvent;
    }
  }

  async cancel(runId: string): Promise<void> {
    const cancel = this.pendingCancellations.get(runId);
    if (cancel) {
      cancel();
      this.pendingCancellations.delete(runId);
      log.info("Cancelled Gemini run", { runId });
    }
  }
}
