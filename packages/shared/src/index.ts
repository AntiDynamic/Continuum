/**
 * Public API for @continuum/shared.
 *
 * Import from "@continuum/shared" — do not import from deep module paths.
 */

// Agent adapter interfaces
export type {
  AgentAdapter,
  AgentAvailability,
  AgentCapabilities,
  AgentExecutionPolicy,
  AgentRunInput,
} from "./agent-adapter.js";

// Normalised event union and all event types
export type {
  AgentEvent,
  AgentEventType,
  EventHeader,
  EventSource,
  ParseStatus,
  RunStartedEvent,
  AgentInitEvent,
  AgentMessageEvent,
  ToolCallEvent,
  ToolResultEvent,
  AgentUsageEvent,
  TokenUsageEvent,
  StdoutEvent,
  StderrEvent,
  UnknownAgentEvent,
  RunCompletedEvent,
  RunFailedEvent,
  AgentResultEvent,
  AgentErrorEvent,
  AgentFailureKind,
} from "./agent-events.js";

// Configuration
export {
  ContinuumConfigSchema,
  DEFAULT_CONFIG,
} from "./config.js";
export type {
  ContinuumConfig,
  AttributionConfidence,
  RunPhase,
  ChangeType,
  RunStatus,
  OutcomeStatus,
  MetricQuality,
  OutputMode,
  TestPhase,
} from "./config.js";

// Error classes
export {
  ContinuumError,
  ConfigError,
  AgentNotFoundError,
  AgentRunError,
  GitError,
  NotARepositoryError,
  DatabaseError,
  RunNotFoundError,
  TestTimeoutError,
  NotInitialisedError,
} from "./errors.js";
export * from "./context-efficiency.js";

// Redaction
export {
  redactString,
  redactValue,
  redactCommand,
  redactJsonString,
} from "./redaction.js";
export type { RedactedCommand, RedactionResult } from "./redaction.js";
export * from "./context-domain.js";
export * from "./ranking.js";
export * from "./packing.js";
export * from "./context-compiler-domain.js";

// Logger
export { createLogger } from "./logger.js";
export type { Logger, LogLevel } from "./logger.js";

// Utilities
export {
  normalisePath,
  resolveNormalised,
  generateRunId,
  generateEventId,
  now,
  parseDurationMs,
  formatDuration,
  truncate,
} from "./utils.js";

export * from "./context-session.js";
