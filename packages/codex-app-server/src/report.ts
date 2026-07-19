import { relative, resolve } from "node:path";
import type { Db, CodexExecutionRow } from "@continuum/database";
import { CodexExecutionRepository } from "@continuum/database";
import type { ContextCoverageRequirement } from "@continuum/shared";
import { parseSearchCommand } from "./normalizer.js";

// ─── Schema versions ────────────────────────────────────────────────────────
// v1: original schema. Maintained for backward compatibility; do NOT change its types.
// v2: corrects exploration evidence (reads ≠ edits), requirement states, metric formulas,
//     per-item evidence (packet section, coverage categories, selection reasons, raw-event provenance).
export const SHADOW_REPORT_SCHEMA_VERSION_V1 = "continuum.shadow-flight-recorder.v1" as const;
export const SHADOW_REPORT_SCHEMA_VERSION = "continuum.shadow-flight-recorder.v2" as const;

const parse = (value: string): any => { try { return JSON.parse(value) } catch { return {} } };
const parseArr = (value: string): string[] => { try { const r = JSON.parse(value); return Array.isArray(r) ? r : []; } catch { return []; } };
const slash = (value: string): string => value.replaceAll("\\", "/").replace(/^\.\//, "");

/** Delivery item requirement state — exact values stored in context_session_delivery_items.requirement_state */
export type ContextDeliveryItemRequirementState =
  | "required"
  | "recommended"
  | "optional"
  | "not_applicable"
  | "unavailable"
  | "unknown_legacy";

/** Packet section — exact values stored in context_session_delivery_items.packet_section */
export type ContextPacketSection =
  | "orientation"
  | "exact_implementation"
  | "mandatory_contracts_constraints"
  | "directly_related_tests"
  | "optional_context"
  | "unknown_legacy";

/** Evidence labels — see docs/shadow-flight-recorder.md */
export type FlightRecorderEvidenceLabel =
  | "direct_file_read"           // File was directly opened/read by the agent
  | "direct_repository_search"   // Agent directly searched the repo (search tool / rg)
  | "command_inferred_read"      // Path inferred from a shell command argument
  | "command_inferred_search"    // Search command (rg/grep) inferred a path was searched
  | "file_edit"                  // File was modified by the agent
  | "diff_observed"              // Path appears in a turn diff
  | "test_command_inferred"      // Path inferred from a test command
  | "unknown";                   // Not categorisable

export interface FlightRecorderEvidenceRecord {
  path: string | null;
  symbol: string | null;
  evidenceType: FlightRecorderEvidenceLabel;
  /**
   * Raw event sequence number from codex_raw_events.
   * null only when the evidence cannot be traced to a single raw event
   * (e.g., diff-derived aggregate evidence when the source event is unavailable).
   * Never -1.
   */
  rawEventSequence: number | null;
  /** Corresponding normalized event ID, when available. */
  normalizedEventId: string | null;
  confidence: "high" | "medium" | "low";
  sourceMethod: string;
  command: string | null;
}

export interface ShadowFlightRecorderReport {
  schemaVersion: typeof SHADOW_REPORT_SCHEMA_VERSION;
  execution: {
    executionId: string; sessionId: string; repositoryId: string; task: string;
    snapshot: { snapshot_kind: string; base_commit_hash: string; worktree_hash: string | null; dirty: boolean };
    finalSnapshot: {
      available: boolean;
      base_commit_hash: string | null;
      worktree_hash: string | null;
      error: string | null;
    };
    codexVersion: string; model: string | null; status: string; durationMs: number;
  };
  prediction: {
    estimatedTokens: number;
    items: Array<{
      id: string; path: string; symbol: string | null;
      /** True only if requirementState === "required" */
      mandatory: boolean;
      /** Accurate per-item requirement state (not delivery-level aggregate) */
      requirementState: ContextDeliveryItemRequirementState;
      /** Packet section this item was assigned to by the context compiler */
      packetSection: ContextPacketSection;
      /** Per-item coverage categories (not delivery-level aggregate) */
      coverageCategories: string[];
      /** Selection reasons from the retrieval engine for this specific item */
      selectionReasons: string[];
      /** Exact match reason (symbol/title/path match), null if not applicable */
      exactMatchReason: string | null;
      /** Relationship expansion reason, null if not applicable */
      relationshipReason: string | null;
      /** Coverage completion reason, null if not applicable */
      coverageReason: string | null;
      estimatedTokens: number;
      deliveryId: string | null;
      deliveryRole: string;
      /** @deprecated Use coverageCategories (plural). */
      coverageCategory: string[];
      /** @deprecated Use selectionReasons (plural). */
      selectionReason: string;
    }>;
    mandatoryCoverage: unknown[];
  };
  exploration: {
    /** Paths directly observed as read (not available in current Codex schema — always empty). */
    directlyObservedReadPaths: string[];
    /** Paths inferred from shell command arguments (rg, cat, etc.) — not proven reads. */
    commandInferredReadPaths: string[];
    /** Paths passed to search commands. */
    searchedPaths: string[];
    /** Symbols passed to search commands. */
    searchedSymbols: string[];
    /** Files modified by the agent — distinct from reads. */
    editedPaths: string[];
    /** Files appearing in turn diffs. */
    diffPaths: string[];
    /** Paths inferred from test commands. */
    testRelatedPaths: string[];
    /** Paths encountered that cannot be classified. */
    unknownReferencedPaths: string[];
    /**
     * Union of all activity evidence paths:
     *   commandInferredReadPaths ∪ searchedPaths ∪ editedPaths ∪ diffPaths ∪ testRelatedPaths
     * This is NOT "everything the model saw" — it is what is visible in available evidence.
     */
    observedActivityPaths: string[];
    /** Raw evidence records for inspection, with real raw-event sequence numbers. */
    evidenceRecords: FlightRecorderEvidenceRecord[];
    commands: unknown[];
    tests: unknown[];
    /** @deprecated Use editedPaths. Kept for v1 consumers; same as editedPaths. */
    changedPaths: string[];
    /** @deprecated Use commandInferredReadPaths + editedPaths. Kept for v1 consumers. */
    inferredPaths: string[];
    /** @deprecated Always empty in v2 — the Codex schema exposes edits, not reads. Use commandInferredReadPaths instead. */
    directlyObservedPaths: string[];
  };
  comparison: {
    /** Predicted paths that were also seen in activity evidence (strongest overlap). */
    predictedAndObserved: unknown[];
    /** Predicted paths not seen in any activity evidence. */
    predictedNotObserved: unknown[];
    /** Activity evidence paths not predicted. */
    observedNotPredicted: unknown[];
    /**
     * Required predicted items whose paths did not appear in any available activity evidence.
     * IMPORTANT: Absence from activity evidence does NOT prove the model did not read or receive the item.
     */
    requiredPredictionsWithoutObservedActivity: unknown[];
    /** @deprecated Use requiredPredictionsWithoutObservedActivity. */
    mandatoryPredictionMisses: unknown[];

    /**
     * predictedActivityCoverage = |predicted ∩ observedActivity| / |observedActivity|
     * Of all paths visible in Codex activity evidence, how many were predicted?
     * null when no observed activity paths exist.
     */
    predictedActivityCoverage: number | null;
    /**
     * predictionActivityPrecision = |predicted ∩ observedActivity| / |predicted|
     * Of predicted paths, how many appeared in activity evidence?
     * null when no predicted paths exist.
     */
    predictionActivityPrecision: number | null;
    /**
     * editPredictionCoverage = |predicted ∩ editedPaths| / |editedPaths|
     * Of edited files, how many were predicted?
     * null when no edited paths exist.
     */
    editPredictionCoverage: number | null;
    /**
     * diffPredictionCoverage = |predicted ∩ diffPaths| / |diffPaths|
     * Of diff files, how many were predicted?
     * null when no diff paths exist.
     */
    diffPredictionCoverage: number | null;
    /**
     * requiredActivityObservationRate = |required predicted ∩ observedActivity| / |required predicted|
     * Of required predicted paths, how many appeared in activity evidence?
     * null when no required predicted paths exist.
     */
    requiredActivityObservationRate: number | null;

    /** @deprecated Use predictedActivityCoverage. Was labelled as observationRecall in v2a. */
    observationRecall: number | null;
    /** @deprecated Use predictionActivityPrecision. Was labelled as predictionPrecision in v2a. */
    predictionPrecision: number | null;
    /** @deprecated Use observationRecall. Was incorrectly calculated in v1. */
    overlapRecall: number | null;
    /** @deprecated Use predictionPrecision. Was incorrectly calculated in v1. */
    overlapPrecision: number | null;
  };
  usage: { accumulated: unknown | null; exactResponses: unknown[]; availability: "measured" | "partial" | "unavailable" };
  outcome: { turnStatus: string; testsObserved: boolean; testsPassed: boolean | null; diffCaptured: boolean; changedFileCount: number };
  evidenceWarnings: string[];
}

// ─── Report builder ──────────────────────────────────────────────────────────
function duration(row: CodexExecutionRow): number { return Math.max(0, new Date(row.completed_at ?? new Date().toISOString()).getTime() - new Date(row.started_at).getTime()); }

export function buildShadowReport(db: Db, executionId: string, _repositoryRoot: string): ShadowFlightRecorderReport {
  const repository = new CodexExecutionRepository(db);
  const execution = repository.findRequired(executionId);
  const events = repository.listNormalized(executionId);
  const usage = repository.listUsage(executionId);
  const diff = repository.latestDiff(executionId);

  // Session & delivery data
  const session = db.prepare("SELECT task_analysis_json FROM context_sessions WHERE id=?").get(execution.session_id) as { task_analysis_json: string };
  const analysis = parse(session.task_analysis_json);

  // ─── Orientation delivery items: load per-item evidence fields (migration 7) ─
  // Falls back to delivery-level aggregate for rows created before migration 7
  // (those have requirement_state='unknown_legacy', coverage_categories_json='[]')
  const predicted = db.prepare(
    `SELECT v.id, v.source_path, v.symbol_name, i.estimated_tokens, i.delivery_role,
            d.id AS delivery_id, d.stage, d.coverage_added_json,
            i.requirement_state, i.coverage_categories_json, i.packet_section,
            i.selection_reasons_json, i.exact_match_reason, i.relationship_reason, i.coverage_reason
     FROM context_session_delivery_items i
     JOIN context_session_deliveries d ON d.id = i.delivery_id
     JOIN context_item_versions v ON v.id = i.context_item_version_id
     WHERE d.session_id = ? AND d.stage = 'orientation' AND i.delivery_role IN ('new','restored')
     ORDER BY d.sequence_number, i.rowid`
  ).all(execution.session_id) as Array<{
    id: string; source_path: string; symbol_name: string | null;
    estimated_tokens: number; delivery_role: string;
    delivery_id: string; stage: string; coverage_added_json: string;
    requirement_state: string; coverage_categories_json: string; packet_section: string;
    selection_reasons_json: string; exact_match_reason: string | null;
    relationship_reason: string | null; coverage_reason: string | null;
  }>;

  // Build requirement state lookup from task analysis (for legacy rows)
  const requirementStates = new Map<string, ContextCoverageRequirement["state"]>();
  if (Array.isArray(analysis.requiredCoverage)) {
    for (const req of analysis.requiredCoverage as ContextCoverageRequirement[]) {
      requirementStates.set(req.category, req.state);
    }
  }

  // Normalise events with payloads
  const payloads = events.map((event: any) => ({ ...event, payload: parse(event.payload_json) }));

  // Commands and tests
  const commands = payloads.filter((e: any) => e.event_type === "command_execution")
    .map((e: any) => ({ ...e.payload, sourceEventSequence: e.raw_sequence_number, normalizedEventId: e.id, evidenceType: e.evidence_type, confidence: e.confidence }));
  const tests = payloads.filter((e: any) => e.event_type === "test_execution")
    .map((e: any) => ({ ...e.payload, sourceEventSequence: e.raw_sequence_number, normalizedEventId: e.id, evidenceType: e.evidence_type, confidence: e.confidence }));

  // ─── Exploration evidence ──────────────────────────────────────────────────
  // Build evidence records WITH real raw-event sequence numbers
  const evidenceRecords: FlightRecorderEvidenceRecord[] = [];

  // editedPaths: files modified by the agent (from file_edit events)
  const editedPathsAll: string[] = [];
  for (const e of payloads.filter((ev: any) => ev.event_type === "file_edit")) {
    for (const change of (e.payload.changes ?? [])) {
      const p = slash(String(change.path));
      editedPathsAll.push(p);
      evidenceRecords.push({ path: p, symbol: null, evidenceType: "file_edit", rawEventSequence: e.raw_sequence_number as number, normalizedEventId: e.id as string, confidence: "high", sourceMethod: "fileChange_item", command: null });
    }
  }
  const editedPaths = [...new Set(editedPathsAll)];

  // diffPaths: paths from turn diffs (if available)
  const diffPaths: string[] = [];
  if (diff) {
    const diffText = String((diff as any).diff_text ?? "");
    const diffMatches = diffText.match(/^\+\+\+ b\/(.+)$/mg) ?? [];
    const rawSeq: number | null = (diff as any).raw_sequence_number ?? null;
    for (const m of diffMatches) {
      const p = m.replace(/^\+\+\+ b\//, "").trim();
      if (p && p !== "/dev/null") {
        diffPaths.push(slash(p));
        evidenceRecords.push({ path: slash(p), symbol: null, evidenceType: "diff_observed", rawEventSequence: rawSeq, normalizedEventId: null, confidence: "high", sourceMethod: "persisted_turn_diff", command: null });
      }
    }
  }

  // commandInferredReadPaths: paths inferred from non-search commands
  for (const e of payloads.filter((ev: any) => ev.event_type === "file_read_evidence")) {
    const p = slash(String(e.payload.path));
    evidenceRecords.push({ path: p, symbol: null, evidenceType: "command_inferred_read", rawEventSequence: e.raw_sequence_number as number, normalizedEventId: e.id as string, confidence: "medium", sourceMethod: "command_argument_inference", command: e.payload.command ?? null });
  }
  const commandInferredReadPaths = [...new Set(
    payloads.filter((e: any) => e.event_type === "file_read_evidence").map((e: any) => slash(String(e.payload.path)))
  )];

  // searchedPaths and searchedSymbols: use normalizer parser (NOT inline regex)
  // First try to get from pre-normalized payload fields (if normalizer populated them)
  // Then fall back to parsing the raw command via parseSearchCommand
  for (const e of payloads.filter((ev: any) => ev.event_type === "repository_search")) {
    const payload = e.payload;
    const rawSeq = e.raw_sequence_number as number;
    const normId = e.id as string;

    // Use pre-parsed fields if available (populated by normalizer.ts)
    if (Array.isArray(payload.searchedPaths)) {
      for (const p of payload.searchedPaths as string[]) {
        evidenceRecords.push({ path: slash(p), symbol: null, evidenceType: "command_inferred_search", rawEventSequence: rawSeq, normalizedEventId: normId, confidence: "medium", sourceMethod: "search_command_argument", command: payload.command ?? null });
      }
    } else if (payload.path) {
      evidenceRecords.push({ path: slash(String(payload.path)), symbol: null, evidenceType: "command_inferred_search", rawEventSequence: rawSeq, normalizedEventId: normId, confidence: "medium", sourceMethod: "search_command_argument", command: payload.command ?? null });
    }
    if (Array.isArray(payload.searchedSymbols)) {
      for (const sym of payload.searchedSymbols as string[]) {
        evidenceRecords.push({ path: null, symbol: sym, evidenceType: "direct_repository_search", rawEventSequence: rawSeq, normalizedEventId: normId, confidence: "medium", sourceMethod: "search_command_symbol", command: payload.command ?? null });
      }
    } else if (payload.command) {
      // Fall back: parse command via normalizer
      const parsed = parseSearchCommand(String(payload.command));
      for (const sym of parsed.searchedSymbols) {
        evidenceRecords.push({ path: null, symbol: sym, evidenceType: "direct_repository_search", rawEventSequence: rawSeq, normalizedEventId: normId, confidence: "medium", sourceMethod: "search_command_symbol_parsed", command: payload.command ?? null });
      }
    }
  }
  // Also parse search from command_execution events for rg/grep patterns
  for (const e of payloads.filter((ev: any) => ev.event_type === "command_execution")) {
    const cmd = String(e.payload?.command ?? "");
    if (!cmd) continue;
    const parsed = parseSearchCommand(cmd);
    if (parsed.tool === "unknown") continue;
    for (const sym of parsed.searchedSymbols) {
      evidenceRecords.push({ path: null, symbol: sym, evidenceType: "command_inferred_search", rawEventSequence: e.raw_sequence_number as number, normalizedEventId: e.id as string, confidence: "medium", sourceMethod: "search_command_execution_parsed", command: cmd });
    }
    for (const p of parsed.paths) {
      evidenceRecords.push({ path: slash(p), symbol: null, evidenceType: "command_inferred_search", rawEventSequence: e.raw_sequence_number as number, normalizedEventId: e.id as string, confidence: "medium", sourceMethod: "search_command_path_parsed", command: cmd });
    }
  }

  const searchedPaths = [...new Set(
    payloads.filter((e: any) => e.event_type === "repository_search")
      .flatMap((e: any) => {
        if (Array.isArray(e.payload.searchedPaths)) return (e.payload.searchedPaths as string[]).map(slash);
        return e.payload.path ? [slash(String(e.payload.path))] : [];
      })
  )];
  const searchedSymbols = [...new Set([
    ...payloads
      .filter((e: any) => e.event_type === "repository_search")
      .flatMap((e: any) => {
        if (Array.isArray(e.payload.searchedSymbols)) return e.payload.searchedSymbols as string[];
        if (e.payload.command) return parseSearchCommand(String(e.payload.command)).searchedSymbols;
        return [];
      }),
    ...payloads
      .filter((e: any) => e.event_type === "command_execution")
      .flatMap((e: any) => {
        const cmd = String(e.payload?.command ?? "");
        return parseSearchCommand(cmd).searchedSymbols;
      }),
  ])];

  // testRelatedPaths: paths from test commands
  const testRelatedPathsAll: string[] = [];
  for (const e of payloads.filter((ev: any) => ev.event_type === "test_execution")) {
    const cmd = String(e.payload?.command ?? "");
    const matches = (cmd.match(/(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)/g) ?? []).map(slash);
    for (const p of matches) {
      testRelatedPathsAll.push(p);
      evidenceRecords.push({ path: p, symbol: null, evidenceType: "test_command_inferred", rawEventSequence: e.raw_sequence_number as number, normalizedEventId: e.id as string, confidence: "medium", sourceMethod: "test_command_path_argument", command: cmd });
    }
  }
  const testRelatedPaths = [...new Set(testRelatedPathsAll)];

  // observedActivityPaths = commandInferredReadPaths ∪ searchedPaths ∪ editedPaths ∪ diffPaths ∪ testRelatedPaths
  const observedActivityPaths = [...new Set([...commandInferredReadPaths, ...searchedPaths, ...editedPaths, ...diffPaths, ...testRelatedPaths])];
  const predictedPaths = [...new Set(predicted.map(item => slash(item.source_path)))];
  const overlap = predictedPaths.filter(path => observedActivityPaths.includes(path));

  // ─── Prediction items with per-item evidence ───────────────────────────────
  const hasLegacyItems = predicted.some(item => item.requirement_state === "unknown_legacy");

  const predictedItems = predicted.map(item => {
    const path = slash(item.source_path);
    const isLegacy = item.requirement_state === "unknown_legacy";

    let requirementState: ContextDeliveryItemRequirementState;
    let coverageCategories: string[];
    let selectionReasons: string[];

    if (isLegacy) {
      // Legacy row: derive from delivery-level aggregate (approximate)
      const coverageAdded = parseArr(item.coverage_added_json);
      coverageCategories = coverageAdded;
      selectionReasons = [];
      // Derive requirement state from task analysis (approximate for legacy rows)
      let best: ContextDeliveryItemRequirementState = "not_applicable";
      for (const cat of coverageAdded) {
        const state = requirementStates.get(cat);
        if (state === "required") { best = "required"; break; }
        if (state === "recommended" && best !== "required") best = "recommended";
        else if (state && best === "not_applicable") best = state as ContextDeliveryItemRequirementState;
      }
      requirementState = coverageAdded.length > 0 ? best : "unknown_legacy";
    } else {
      requirementState = item.requirement_state as ContextDeliveryItemRequirementState;
      coverageCategories = parseArr(item.coverage_categories_json);
      selectionReasons = parseArr(item.selection_reasons_json);
    }

    const packetSection = (item.packet_section ?? "unknown_legacy") as ContextPacketSection;

    return {
      id: item.id,
      path,
      symbol: item.symbol_name,
      mandatory: requirementState === "required",
      requirementState,
      packetSection,
      coverageCategories,
      selectionReasons,
      exactMatchReason: item.exact_match_reason ?? null,
      relationshipReason: item.relationship_reason ?? null,
      coverageReason: item.coverage_reason ?? null,
      estimatedTokens: item.estimated_tokens,
      deliveryId: item.delivery_id,
      deliveryRole: item.delivery_role,
      // Deprecated compat aliases
      coverageCategory: coverageCategories,
      selectionReason: item.delivery_role,
    };
  });

  // Mandatory misses: only genuinely required items whose path was not observed
  const mandatoryMisses = predictedItems.filter(item =>
    item.requirementState === "required" && !observedActivityPaths.includes(item.path)
  );

  const comparisonItem = (path: string) => ({
    path,
    evidence: editedPaths.includes(path) ? "file_edit" : diffPaths.includes(path) ? "diff_observed" : searchedPaths.includes(path) ? "command_inferred_search" : commandInferredReadPaths.includes(path) ? "command_inferred_read" : "test_command_inferred",
  });

  // ─── Comparison metrics ───────────────────────────────────────────────────
  // predictedActivityCoverage = |predicted ∩ observedActivity| / |observedActivity|
  const predictedActivityCoverage = observedActivityPaths.length ? overlap.length / observedActivityPaths.length : null;
  // predictionActivityPrecision = |predicted ∩ observedActivity| / |predicted|
  const predictionActivityPrecision = predictedPaths.length ? overlap.length / predictedPaths.length : null;
  // editPredictionCoverage = |predicted ∩ editedPaths| / |editedPaths|
  const editOverlap = predictedPaths.filter(p => editedPaths.includes(p));
  const editPredictionCoverage = editedPaths.length ? editOverlap.length / editedPaths.length : null;
  // diffPredictionCoverage = |predicted ∩ diffPaths| / |diffPaths|
  const diffOverlap = predictedPaths.filter(p => diffPaths.includes(p));
  const diffPredictionCoverage = diffPaths.length ? diffOverlap.length / diffPaths.length : null;
  // requiredActivityObservationRate = |required predicted ∩ observedActivity| / |required predicted|
  const requiredPredicted = predictedItems.filter(i => i.requirementState === "required").map(i => i.path);
  const requiredObserved = requiredPredicted.filter(p => observedActivityPaths.includes(p));
  const requiredActivityObservationRate = requiredPredicted.length ? requiredObserved.length / requiredPredicted.length : null;

  // ─── Usage ────────────────────────────────────────────────────────────────
  const accumulated = usage.filter((row: any) => row.accumulation === "accumulated").at(-1) ?? null;
  const exact = usage.filter((row: any) => row.accumulation === "per_response");

  // ─── Outcome ──────────────────────────────────────────────────────────────
  const testsPassed = tests.length ? tests.every((test: any) => test.status === "passed") : null;

  // ─── Final snapshot ───────────────────────────────────────────────────────
  const finalSnapshotAvailable = (execution as any).final_snapshot_available !== 0;
  const finalSnapshotError = (execution as any).final_snapshot_error ?? null;

  // ─── Evidence warnings ────────────────────────────────────────────────────
  const warnings: string[] = [
    "Shadow mode did not restrict Codex or inject Continuum prediction content.",
    "Command-inferred paths are not proof that a file was read — they are shell command arguments.",
    "The Codex App Server schema does not expose direct file-read events; directlyObservedReadPaths will always be empty.",
    "Absence from activity evidence does not prove that the model did not read or receive an item.",
    "Observed-not-predicted paths are additional exploration, not automatically unnecessary.",
    "Continuum packet tokens are estimated; no token-savings claim is made.",
  ];
  if (hasLegacyItems) {
    warnings.push("One or more predicted items use unknown_legacy evidence because they were created before per-item evidence persistence was introduced. Their requirement states are derived from delivery-level aggregates and may not be accurate.");
  }
  if (execution.repository_changed) warnings.push("Repository state changed during execution; external concurrent changes cannot be excluded from App Server evidence alone.");
  if (!finalSnapshotAvailable) warnings.push("Final snapshot could not be resolved; snapshot comparison is unavailable.");

  return {
    schemaVersion: SHADOW_REPORT_SCHEMA_VERSION,
    execution: {
      executionId,
      sessionId: execution.session_id,
      repositoryId: String(execution.repository_id),
      task: execution.task_text,
      snapshot: {
        snapshot_kind: execution.worktree_hash ? "worktree" : "commit",
        base_commit_hash: execution.base_commit_hash,
        worktree_hash: execution.worktree_hash,
        dirty: Boolean(execution.worktree_hash),
      },
      finalSnapshot: {
        available: finalSnapshotAvailable,
        base_commit_hash: execution.final_base_commit_hash ?? null,
        worktree_hash: execution.final_worktree_hash ?? null,
        error: finalSnapshotError,
      },
      codexVersion: execution.codex_version,
      model: execution.model,
      status: execution.status,
      durationMs: duration(execution),
    },
    prediction: {
      estimatedTokens: predicted.reduce((sum, item) => sum + item.estimated_tokens, 0),
      items: predictedItems,
      mandatoryCoverage: analysis.requiredCoverage ?? [],
    },
    exploration: {
      directlyObservedReadPaths: [], // Not available in Codex App Server schema 0.133.0
      commandInferredReadPaths,
      searchedPaths,
      searchedSymbols,
      editedPaths,
      diffPaths,
      testRelatedPaths,
      unknownReferencedPaths: [],
      observedActivityPaths,
      evidenceRecords,
      commands,
      tests,
      // v1 compat aliases
      changedPaths: editedPaths,
      inferredPaths: [...commandInferredReadPaths, ...searchedPaths],
      directlyObservedPaths: editedPaths, // v1 consumers: note this is edits, not reads
    },
    comparison: {
      predictedAndObserved: overlap.map(comparisonItem),
      predictedNotObserved: predictedPaths.filter(path => !observedActivityPaths.includes(path)).map(path => ({ path, evidence: "prediction" })),
      observedNotPredicted: observedActivityPaths.filter(path => !predictedPaths.includes(path)).map(comparisonItem),
      requiredPredictionsWithoutObservedActivity: mandatoryMisses,
      /** @deprecated Use requiredPredictionsWithoutObservedActivity */
      mandatoryPredictionMisses: mandatoryMisses,
      predictedActivityCoverage,
      predictionActivityPrecision,
      editPredictionCoverage,
      diffPredictionCoverage,
      requiredActivityObservationRate,
      // Deprecated aliases (corrected values)
      observationRecall: predictedActivityCoverage,
      predictionPrecision: predictionActivityPrecision,
      overlapRecall: predictedActivityCoverage,
      overlapPrecision: predictionActivityPrecision,
    },
    usage: {
      accumulated,
      exactResponses: exact,
      availability: accumulated ? (exact.length ? "partial" : "measured") : (exact.length ? "partial" : "unavailable"),
    },
    outcome: {
      turnStatus: execution.status,
      testsObserved: tests.length > 0,
      testsPassed,
      diffCaptured: Boolean(diff),
      changedFileCount: editedPaths.length,
    },
    evidenceWarnings: warnings,
  };
}
