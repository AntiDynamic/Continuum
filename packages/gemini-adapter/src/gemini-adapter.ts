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

import { execa, type Options } from "execa";
import { createReadlineInterface } from "./readline-helper.js";
import { parseGeminiLine, createParseContext } from "./parser.js";
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

const GEMINI_EXECUTABLE = process.env["CONTINUUM_GEMINI_EXECUTABLE"] ?? "gemini";

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
      telemetry: {
        reportsInputTokens: hasStreamJson,
        reportsCachedInputTokens: hasStreamJson,
        reportsOutputTokens: hasStreamJson,
        reportsReasoningTokens: false,
        reportsToolUsage: hasStreamJson,
        reportsModelIdentity: hasStreamJson,
      },
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
      ...(input.additionalArgs ?? []),
    ];

    if (input.policy.unsafeAutoApprove) {
      console.warn("WARNING: Unsafe auto-approval is enabled.\nGemini may execute commands and modify files without interactive confirmation.\nUse this only inside a disposable or trusted repository.");
      args.push("--yolo");
    }

    const { displayCommand, executable, args: redactedArgs, redactionApplied } = 
      (await import("@continuum/shared")).redactCommand(GEMINI_EXECUTABLE, args, input.policy.redactPatterns);

    const ctx = createParseContext(input.runId, input.policy.redactPatterns, input.policy.captureRawOutput);
    const startTime = Date.now();
    let initReceived = false;
    let agentEventReceived = false;
    let textOutputReceived = false;

    // Emit run_started event
    const startedEvent: RunStartedEvent = {
      eventId: generateEventId(),
      runId: input.runId,
      sequenceNumber: 0,
      timestamp: now(),
      source: "system",
      redactionApplied,
      eventType: "run_started",
      payload: {
        command: displayCommand,
        args: redactedArgs,
        outputMode,
      },
    };
    yield startedEvent;

    let child: ReturnType<typeof execa> | undefined;
    let trustFailed = false;
    let approvalRequired = false;
    let authRequired = false;

    // Trust output classifier
    const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
    const stripAnsi = (text: string) => text.replace(ansiEscapePattern, "");
    const isTrustPrompt = (text: string) => /do you trust the files in this folder|untrusted folder|project agents due to untrusted folder|folder is not trusted|workspace is not trusted/i.test(stripAnsi(text));
    const isApprovalPrompt = (text: string) => /approval required/i.test(stripAnsi(text));
    const isAuthPrompt = (text: string) => /authentication required/i.test(stripAnsi(text));

    try {
      const execaOptions: Options = {
        cwd: input.workingDirectory,
        reject: false,
        all: false,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore", // Prevent hanging on interactive prompts
        ...(input.timeoutMs !== undefined ? { timeout: input.timeoutMs } : {})
      };

      child = execa(GEMINI_EXECUTABLE, args, execaOptions);

      if (child.pid !== undefined) {
        this.pendingCancellations.set(input.runId, () => {
          child?.kill("SIGTERM");
        });
      }

      if (input.signal) {
        input.signal.addEventListener("abort", () => {
          child?.kill("SIGTERM");
        });
      }

      // Concurrently consume stdout and stderr using an async generator queue
      const queue: AgentEvent[] = [];
      let resolveQueue: (() => void) | null = null;
      let stdoutDone = false;
      let stderrDone = false;

      const pushEvent = (evt: AgentEvent) => {
        queue.push(evt);
        if (resolveQueue) resolveQueue();
      };

      const processStdout = async () => {
        if (!child?.stdout) {
          stdoutDone = true;
          if (resolveQueue) resolveQueue();
          return;
        }
        const stdoutRl = createReadlineInterface(child.stdout);
        for await (const line of stdoutRl) {
          if (!line.trim()) continue;
          textOutputReceived = true;
          if (isTrustPrompt(line)) trustFailed = true;
          if (isApprovalPrompt(line)) approvalRequired = true;
          if (isAuthPrompt(line)) authRequired = true;

          const event = parseGeminiLine(line, ctx, false);
          if (event.eventType === "agent_init") initReceived = true;
          if (event.eventType !== "stdout" && event.eventType !== "stderr" && event.eventType !== "unknown_agent_event") agentEventReceived = true;
          pushEvent(event);
        }
        stdoutDone = true;
        if (resolveQueue) resolveQueue();
      };

      const processStderr = async () => {
        if (!child?.stderr) {
          stderrDone = true;
          if (resolveQueue) resolveQueue();
          return;
        }
        const stderrRl = createReadlineInterface(child.stderr);
        for await (const line of stderrRl) {
          if (!line.trim()) continue;
          textOutputReceived = true;
          if (isTrustPrompt(line)) trustFailed = true;
          if (isApprovalPrompt(line)) approvalRequired = true;
          if (isAuthPrompt(line)) authRequired = true;
          const event = parseGeminiLine(line, ctx, true);
          pushEvent(event);
        }
        stderrDone = true;
        if (resolveQueue) resolveQueue();
      };

      processStdout().catch(() => { stdoutDone = true; if (resolveQueue) resolveQueue(); });
      processStderr().catch(() => { stderrDone = true; if (resolveQueue) resolveQueue(); });

      // Initialization timeout timer
      let initTimeoutFired = false;
      let initTimer: NodeJS.Timeout | undefined;
      
      if (outputMode !== "json") {
        initTimer = setTimeout(() => {
          let hasActivity = false;
          if (outputMode === "stream-json") {
            hasActivity = initReceived || agentEventReceived;
          } else if (outputMode === "text") {
            hasActivity = textOutputReceived;
          }

          if (!hasActivity) {
            initTimeoutFired = true;
            child?.kill("SIGTERM");
          }
        }, input.policy.initializationTimeoutMs);
      }

      // Yield events as they arrive
      while (!stdoutDone || !stderrDone || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>((r) => { resolveQueue = r; });
          resolveQueue = null;
        }
      }

      clearTimeout(initTimer);

      const result = await child;
      const durationMs = Date.now() - startTime;
      this.pendingCancellations.delete(input.runId);

      // Determine failure kind
      let failureKind: string | undefined;
      let failureReason: string | undefined;

      if (trustFailed) {
        failureKind = "untrusted_workspace";
        failureReason = "Gemini did not run because this repository is not trusted.\n\nOpen Gemini manually in this repository and approve folder trust:\n\n  cd \"<repository-path>\"\n  gemini\n\nChoose “Trust folder” for this repository only, then rerun Continuum.\n\nContinuum did not bypass or modify Gemini’s trust settings.";
      } else if (approvalRequired) {
        failureKind = "approval_required";
        failureReason = "Gemini requires interactive approval for this task.\n\nRun Gemini manually for this task, or rerun Continuum with the explicitly unsafe\n--unsafe-auto-approve option inside a disposable or fully trusted repository.";
      } else if (authRequired) {
        failureKind = "authentication_required";
        failureReason = "Authentication is required to use Gemini.";
      } else if (initTimeoutFired) {
        failureKind = "timed_out";
        failureReason = "Gemini initialization timed out. It may be waiting for trust, authentication, or approval.";
      } else if (result.timedOut) {
        failureKind = "timed_out";
        failureReason = `Gemini CLI timed out after ${String(input.timeoutMs ?? "unknown")}ms`;
      } else if (result.isCanceled) {
        failureKind = "cancelled";
        failureReason = "Cancelled by user";
      } else if (result.exitCode !== 0) {
        failureKind = "non_zero_exit";
        failureReason = `Gemini CLI exited with code ${result.exitCode}`;
      }

      if (failureKind) {
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
            reason: failureReason!,
            durationMs,
            timedOut: failureKind === "timed_out",
            cancelled: failureKind === "cancelled",
            failureKind: failureKind as import("@continuum/shared").AgentFailureKind,
          },
        };
        yield failedEvent;
      } else {
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
      }

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
          failureKind: "unknown",
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
