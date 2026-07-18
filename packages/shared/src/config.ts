import { z } from "zod";

/**
 * Continuum configuration file schema (.continuum/config.json).
 * All fields have conservative defaults so partial configs are still usable.
 */
export const ContinuumConfigSchema = z.object({
  /** Schema version — allows forward-compatible migration. */
  version: z.literal(1),
  /** Default agent adapter ID. */
  defaultAgent: z.string().default("gemini"),
  /** Shell commands run before and after the agent. */
  testCommands: z.array(z.string()).default([]),
  /** Build commands run after the agent. */
  buildCommands: z.array(z.string()).default([]),
  /**
   * Additional regex patterns to redact from raw output before storage.
   * Continuum ships built-in patterns; these augment them.
   */
  redactPatterns: z.array(z.string()).default([]),
  /** Whether to store raw agent stdout/stderr in addition to parsed events. */
  /** Optional semantic retrieval remains local and disabled by default. */
  retrieval: z.object({
    semantic: z.object({
      enabled: z.boolean().default(false),
      backend: z.literal("disabled").default("disabled"),
    }).default({ enabled: false, backend: "disabled" }),
  }).default({ semantic: { enabled: false, backend: "disabled" } }),
  captureRawOutput: z.boolean().default(true),
});

export type ContinuumConfig = z.infer<typeof ContinuumConfigSchema>;

export const DEFAULT_CONFIG: ContinuumConfig = {
  version: 1,
  defaultAgent: "gemini",
  testCommands: [],
  buildCommands: [],
  redactPatterns: [],
  captureRawOutput: true,
  retrieval: { semantic: { enabled: false, backend: "disabled" } },
};

/** Working-tree attribution confidence levels. */
export type AttributionConfidence = "high" | "medium" | "low" | "unknown";

/** Phase labels used throughout the system. */
export type RunPhase = "before" | "after";

/** File change classification. */
export type ChangeType =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked"
  | "binary";

/** Agent run terminal status. */
export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

/** User-provided outcome label. */
export type OutcomeStatus =
  | "accepted"
  | "accepted-with-corrections"
  | "rejected"
  | "unknown";

/** Metric reliability label — used in reports. */
export type MetricQuality = "exact" | "derived" | "estimated" | "heuristic";

/** Output modes in increasing order of structure richness. */
export type OutputMode = "stream-json" | "json" | "text" | "unknown";

/** Test phase label. */
export type TestPhase = "baseline" | "final";
