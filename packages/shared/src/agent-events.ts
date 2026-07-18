/**
 * Normalised agent event union.
 *
 * Every adapter must map its agent-specific output into this union.
 * Unknown or unrecognised events must be emitted as UnknownAgentEvent rather
 * than discarded, so future parsers can be improved without data loss.
 *
 * Every event carries a minimal required header (EventHeader) plus a typed
 * payload specific to that event kind.
 */

export type EventSource = "stdout" | "stderr" | "system" | "adapter";
export type ParseStatus = "parsed" | "partial" | "raw" | "error";

export interface EventHeader {
  /** UUID v4, unique per event. */
  eventId: string;
  /** Correlates events to a single agent run. */
  runId: string;
  /** Monotonically increasing within a run, starting at 1. */
  sequenceNumber: number;
  /** ISO-8601 timestamp produced by the adapter. */
  timestamp: string;
  source: EventSource;
  /** Whether the raw payload was redacted before saving. */
  redactionApplied: boolean;
}

/** The agent process has been spawned. */
export interface RunStartedEvent extends EventHeader {
  eventType: "run_started";
  payload: {
    command: string;
    args: string[];
    outputMode: string;
    pid?: number | undefined;
  };
}

/** An initialisation or handshake message from the agent. */
export interface AgentInitEvent extends EventHeader {
  eventType: "agent_init";
  payload: {
    sessionId?: string | undefined;
    model?: string | undefined;
    raw?: string;
  };
}

/** A text message produced by the agent. */
export interface AgentMessageEvent extends EventHeader {
  eventType: "agent_message";
  payload: {
    text?: string;
    role?: string | undefined;
    raw?: string;
  };
}

/** The agent invoked a tool or command. */
export interface ToolCallEvent extends EventHeader {
  eventType: "tool_call";
  payload: {
    toolName: string;
    toolCallId?: string | undefined;
    /** Tool input parameters — structure varies per tool. */
    input: Record<string, any>;
    raw?: string;
  };
}

/** The result of a tool invocation. */
export interface ToolResultEvent extends EventHeader {
  eventType: "tool_result";
  payload: {
    toolCallId?: string | undefined;
    toolName?: string | undefined;
    exitCode?: number | undefined;
    output?: string | undefined;
    raw?: string;
  };
}

/** Token usage reported by the agent — only stored when genuinely provided. */
export interface TokenUsageEvent extends EventHeader {
  eventType: "token_usage";
  payload: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    cachedTokens?: number | undefined;
    totalTokens?: number | undefined;
    /** Model identifier as reported by the agent. */
    model?: string | undefined;
    raw?: string;
  };
}

/** A raw line from stdout that was not successfully parsed as structured data. */
/** Provider-neutral usage evidence emitted only for values the adapter observed. */
export interface AgentUsageEvent extends EventHeader {
  eventType: "agent_usage";
  provider?: string;
  model?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  toolCalls?: number;
  measurement:
    | "provider_reported"
    | "agent_reported"
    | "estimated";
}

export interface StdoutEvent extends EventHeader {
  eventType: "stdout";
  payload: {
    line?: string;
    /** Present when JSON parsing was attempted but failed. */
    parseError?: string | undefined;
  };
}

/** A raw line from stderr. */
export interface StderrEvent extends EventHeader {
  eventType: "stderr";
  payload: {
    line?: string;
  };
}

/**
 * A structured event that was valid JSON/JSONL but whose type is not
 * recognised by the current adapter version.  Stored so future parsers
 * can be retro-fitted without re-running the agent.
 */
export interface UnknownAgentEvent extends EventHeader {
  eventType: "unknown_agent_event";
  payload: {
    originalType?: string | undefined;
    /** The raw JSON string preserved verbatim. */
    raw?: string;
    parseStatus: ParseStatus;
  };
}

export type AgentFailureKind =
  | "untrusted_workspace"
  | "approval_required"
  | "authentication_required"
  | "agent_not_found"
  | "timed_out"
  | "cancelled"
  | "non_zero_exit"
  | "adapter_contract_violation"
  | "unknown";

/** The agent process exited normally. */
export interface RunCompletedEvent extends EventHeader {
  eventType: "run_completed";
  payload: {
    exitCode: number;
    durationMs: number;
  };
}

/** Terminal event emitted when a run fails or is cancelled */
export interface RunFailedEvent extends EventHeader {
  eventType: "run_failed";
  payload: {
    exitCode?: number;
    reason: string;
    durationMs: number;
    timedOut: boolean;
    cancelled: boolean;
    failureKind?: AgentFailureKind;
  };
}

/** An agent internal result event (e.g. Gemini JSON result). */
export interface AgentResultEvent extends EventHeader {
  eventType: "agent_result";
  payload: {
    exitCode?: number | undefined;
    raw?: string;
  };
}

/** An agent internal error event (e.g. Gemini JSON error). */
export interface AgentErrorEvent extends EventHeader {
  eventType: "agent_error";
  payload: {
    reason: string;
    raw?: string;
  };
}

export type AgentEvent =
  | RunStartedEvent
  | AgentInitEvent
  | AgentMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | TokenUsageEvent
  | AgentUsageEvent
  | StdoutEvent
  | StderrEvent
  | UnknownAgentEvent
  | RunCompletedEvent
  | RunFailedEvent
  | AgentResultEvent
  | AgentErrorEvent;

export type AgentEventType = AgentEvent["eventType"];
