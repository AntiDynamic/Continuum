import type { AgentEvent } from "./agent-events.js";
import type { AgentTelemetryCapabilities } from "./context-efficiency.js";

/**
 * Agent adapter interface — the vendor-neutral contract that all coding-agent
 * adapters must satisfy.  Every adapter wraps one specific CLI or SDK but
 * exposes the same surface so the rest of Continuum never needs to know which
 * agent it is talking to.
 */
export interface AgentAdapter {
  /** Machine-readable stable identifier, e.g. "gemini". */
  readonly id: string;
  /** Human-readable name for reports, e.g. "Gemini CLI". */
  readonly displayName: string;

  /** Probe the local system to see whether the agent is usable. */
  detectAvailability(): Promise<AgentAvailability>;

  /** Return what the adapter can actually observe from this agent. */
  getCapabilities(): Promise<AgentCapabilities>;

  /**
   * Launch the agent and stream normalised events.
   * Callers must consume the iterable to completion or call cancel().
   */
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;

  /**
   * Request graceful cancellation of a running task.
   * May also be driven via AgentRunInput.signal.
   */
  cancel(runId: string): Promise<void>;
}

export interface AgentAvailability {
  available: boolean;
  executablePath?: string | undefined;
  version?: string | undefined;
  /** Human-readable reason when unavailable. */
  reason?: string | undefined;
}

export interface AgentCapabilities {
  /** Agent can produce structured (JSON / JSONL) output. */
  structuredOutput: boolean;
  /** Agent supports streaming structured output. */
  streamingOutput: boolean;
  /** Agent reports token usage. */
  tokenUsage: boolean;
  /** Agent emits individual tool-call events. */
  toolEvents: boolean;
  /** Agent exposes a stable session ID. */
  sessionId: boolean;
  /** Agent supports graceful cancellation. */
  cancellation: boolean;
  /** Field-level provider-neutral telemetry evidence exposed by the adapter. */
  telemetry: AgentTelemetryCapabilities;
}

export interface AgentExecutionPolicy {
  captureRawOutput: boolean;
  redactPatterns: string[];
  unsafeAutoApprove: boolean;
  initializationTimeoutMs: number;
}

export interface AgentRunInput {
  runId: string;
  task: string;
  repositoryPath: string;
  workingDirectory: string;
  timeoutMs?: number | undefined;
  additionalArgs?: string[] | undefined;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal | undefined;
  policy: AgentExecutionPolicy;
}
