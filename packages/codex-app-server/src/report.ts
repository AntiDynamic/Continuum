import { relative, resolve } from "node:path";
import type { Db, CodexExecutionRow } from "@continuum/database";
import { CodexExecutionRepository } from "@continuum/database";
import type { ContextCoverageRequirement } from "@continuum/shared";

// ─── Schema versions ────────────────────────────────────────────────────────
// v1: original schema. Maintained for backward compatibility; do NOT change its types.
// v2: corrects exploration evidence (reads ≠ edits), requirement states, metric formulas.
export const SHADOW_REPORT_SCHEMA_VERSION_V1 = "continuum.shadow-flight-recorder.v1" as const;
export const SHADOW_REPORT_SCHEMA_VERSION = "continuum.shadow-flight-recorder.v2" as const;

const parse = (value: string): any => { try { return JSON.parse(value) } catch { return {} } };
const slash = (value: string): string => value.replaceAll("\\", "/").replace(/^\.\//, "");

/** Evidence labels — see docs/shadow-flight-recorder.md */
export type FlightRecorderEvidenceLabel =
  | "direct_file_read"        // File was directly opened/read by the agent
  | "direct_repository_search" // Agent directly searched the repo (search tool / rg)
  | "command_inferred_read"   // Path inferred from a shell command argument
  | "command_inferred_search" // Search command (rg/grep) inferred a path was searched
  | "file_edit"               // File was modified by the agent
  | "diff_observed"           // Path appears in a turn diff
  | "test_command_inferred"   // Path inferred from a test command
  | "unknown";                // Not categorisable

export interface FlightRecorderEvidenceRecord {
  path: string;
  evidenceType: FlightRecorderEvidenceLabel;
  rawEventSequence: number;
  confidence: string;
  sourceMethod: string;
}

export interface ShadowFlightRecorderReport {
  schemaVersion: typeof SHADOW_REPORT_SCHEMA_VERSION;
  execution: {
    executionId: string; sessionId: string; repositoryId: string; task: string;
    snapshot: { snapshot_kind: string; base_commit_hash: string; worktree_hash: string | null; dirty: boolean };
    codexVersion: string; model: string | null; status: string; durationMs: number;
  };
  prediction: {
    estimatedTokens: number;
    items: Array<{
      id: string; path: string; symbol: string | null;
      /** True only if requirementState === "required" */
      mandatory: boolean;
      /** Accurate requirement state for this predicted item */
      requirementState: ContextCoverageRequirement["state"];
      packetSection: string;
      coverageCategory: string[];
      selectionReason: string;
      estimatedTokens: number;
      deliveryId: string | null;
      deliveryItemRole: string;
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
    /** Raw evidence records for inspection. */
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
    /** Predicted paths that were also edited (strongest form of observation available). */
    predictedAndObserved: unknown[];
    /** Predicted paths not seen in any evidence. */
    predictedNotObserved: unknown[];
    /** Edited/inferred paths not predicted. */
    observedNotPredicted: unknown[];
    /** Predicted REQUIRED items whose path was not observed in any evidence. */
    mandatoryPredictionMisses: unknown[];
    /**
     * Prediction recall — fraction of observed (edited+inferred) paths that were predicted.
     * observed∩predicted / |observed|. Null when observed set is empty.
     */
    observationRecall: number | null;
    /**
     * Prediction precision — fraction of predicted paths that were actually observed.
     * observed∩predicted / |predicted|. Null when predicted set is empty.
     */
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

export function buildShadowReport(db: Db, executionId: string, repositoryRoot: string): ShadowFlightRecorderReport {
  const repository = new CodexExecutionRepository(db);
  const execution = repository.findRequired(executionId);
  const events = repository.listNormalized(executionId);
  const usage = repository.listUsage(executionId);
  const diff = repository.latestDiff(executionId);

  // Session & delivery data
  const session = db.prepare("SELECT task_analysis_json FROM context_sessions WHERE id=?").get(execution.session_id) as { task_analysis_json: string };
  const analysis = parse(session.task_analysis_json);

  // Orientation delivery items: join with delivery to get stage, role, section
  const predicted = db.prepare(
    `SELECT v.id, v.source_path, v.symbol_name, i.estimated_tokens, i.delivery_role,
            d.id AS delivery_id, d.stage, d.coverage_added_json
     FROM context_session_delivery_items i
     JOIN context_session_deliveries d ON d.id = i.delivery_id
     JOIN context_item_versions v ON v.id = i.context_item_version_id
     WHERE d.session_id = ? AND d.stage = 'orientation' AND i.delivery_role IN ('new','restored')
     ORDER BY d.sequence_number, i.rowid`
  ).all(execution.session_id) as Array<{
    id: string; source_path: string; symbol_name: string | null;
    estimated_tokens: number; delivery_role: string;
    delivery_id: string; stage: string; coverage_added_json: string;
  }>;

  // Build requirement state lookup from task analysis
  const requirementStates = new Map<string, ContextCoverageRequirement["state"]>();
  const categoryToRole = new Map<string, string>();
  if (Array.isArray(analysis.requiredCoverage)) {
    for (const req of analysis.requiredCoverage as ContextCoverageRequirement[]) {
      requirementStates.set(req.category, req.state);
    }
  }

  // Normalise events with payloads
  const payloads = events.map((event: any) => ({ ...event, payload: parse(event.payload_json) }));

  // Commands and tests
  const commands = payloads.filter((e: any) => e.event_type === "command_execution")
    .map((e: any) => ({ ...e.payload, sourceEventSequence: e.raw_sequence_number, evidenceType: e.evidence_type, confidence: e.confidence }));
  const tests = payloads.filter((e: any) => e.event_type === "test_execution")
    .map((e: any) => ({ ...e.payload, sourceEventSequence: e.raw_sequence_number, evidenceType: e.evidence_type, confidence: e.confidence }));

  // ─── Exploration evidence ──────────────────────────────────────────────────
  // editedPaths: files modified by the agent (from fileChange/file_edit events)
  const editedPaths = [...new Set(
    payloads.filter((e: any) => e.event_type === "file_edit")
      .flatMap((e: any) => (e.payload.changes ?? []).map((change: any) => slash(String(change.path))))
  )];

  // diffPaths: paths from turn diffs (if available)
  const diffPaths: string[] = [];
  if (diff) {
    const diffText = String((diff as any).diff_text ?? "");
    const diffMatches = diffText.match(/^\+\+\+ b\/(.+)$/mg) ?? [];
    for (const m of diffMatches) {
      const p = m.replace(/^\+\+\+ b\//, "").trim();
      if (p && p !== "/dev/null") diffPaths.push(slash(p));
    }
  }

  // commandInferredReadPaths: paths inferred from non-search commands
  const commandInferredReadPaths = [...new Set(
    payloads.filter((e: any) => e.event_type === "file_read_evidence")
      .map((e: any) => slash(String(e.payload.path)))
  )];

  // searchedPaths: paths from search commands (rg, grep, etc.)
  const searchedPaths = [...new Set(
    payloads.filter((e: any) => e.event_type === "repository_search")
      .map((e: any) => slash(String(e.payload.path)))
  )];

  // searchedSymbols: populated from search commands that reference a symbol
  const searchedSymbols = [...new Set(
    payloads
      .filter((e: any) => e.event_type === "repository_search" || e.event_type === "command_execution")
      .flatMap((e: any) => {
        const cmd: string = String(e.payload.command ?? "");
        // Extract symbol from rg/grep commands: rg 'Symbol' or rg "Symbol" or rg Symbol
        const rgMatch = cmd.match(/\brg\b[^|]*?['"]?([A-Za-z_$][A-Za-z0-9_$]{2,})['"]?/);
        return rgMatch ? [rgMatch[1]!] : [];
      })
  )];

  // testRelatedPaths: paths from test commands
  const testRelatedPaths = [...new Set(
    payloads.filter((e: any) => e.event_type === "test_execution")
      .flatMap((e: any) => {
        const cmd: string = String(e.payload.command ?? "");
        return (cmd.match(/(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)/g) ?? []).map(slash);
      })
  )];

  // Build evidence records
  const evidenceRecords: FlightRecorderEvidenceRecord[] = [];
  for (const p of editedPaths) evidenceRecords.push({ path: p, evidenceType: "file_edit", rawEventSequence: -1, confidence: "high", sourceMethod: "fileChange_item" });
  for (const p of commandInferredReadPaths) evidenceRecords.push({ path: p, evidenceType: "command_inferred_read", rawEventSequence: -1, confidence: "medium", sourceMethod: "command_argument_inference" });
  for (const p of searchedPaths) evidenceRecords.push({ path: p, evidenceType: "command_inferred_search", rawEventSequence: -1, confidence: "medium", sourceMethod: "search_command_argument" });
  for (const p of diffPaths) evidenceRecords.push({ path: p, evidenceType: "diff_observed", rawEventSequence: -1, confidence: "high", sourceMethod: "turn_diff" });

  // All observed paths (union of all non-read evidence)
  const observed = [...new Set([...editedPaths, ...commandInferredReadPaths, ...searchedPaths, ...diffPaths])];
  const predictedPaths = [...new Set(predicted.map((item) => slash(item.source_path)))];
  const overlap = predictedPaths.filter((path) => observed.includes(path));

  // ─── Prediction items with accurate requirement state ──────────────────────
  const predictedItems = predicted.map((item) => {
    const path = slash(item.source_path);
    let coverageAdded: string[];
    try { coverageAdded = JSON.parse(item.coverage_added_json) as string[]; } catch { coverageAdded = []; }
    const deriveRequirementState = (categories: string[]): ContextCoverageRequirement["state"] => {
      let best: ContextCoverageRequirement["state"] = "not_applicable";
      for (const cat of categories) {
        const state = requirementStates.get(cat);
        if (state === "required") return "required";
        if (state === "recommended") best = "recommended";
        else if (state && best === "not_applicable") best = state;
      }
      return best;
    };
    const requirementState = deriveRequirementState(coverageAdded);
    return {
      id: item.id,
      path,
      symbol: item.symbol_name,
      mandatory: requirementState === "required",
      requirementState,
      packetSection: item.stage,
      coverageCategory: coverageAdded,
      selectionReason: item.delivery_role,
      estimatedTokens: item.estimated_tokens,
      deliveryId: item.delivery_id,
      deliveryItemRole: item.delivery_role,
    };
  });

  // Mandatory misses: only genuinely required items whose path was not observed
  const mandatoryMisses = predictedItems.filter((item) => item.requirementState === "required" && !observed.includes(item.path));

  const comparisonItem = (path: string) => ({
    path,
    evidence: editedPaths.includes(path) ? "file_edit" : diffPaths.includes(path) ? "diff_observed" : searchedPaths.includes(path) ? "command_inferred_search" : "command_inferred_read",
  });

  // ─── Metrics with correct formulas ────────────────────────────────────────
  // observationRecall = |overlap| / |observed|  (of what was observed, how much was predicted?)
  const observationRecall = observed.length ? overlap.length / observed.length : null;
  // predictionPrecision = |overlap| / |predicted|  (of what was predicted, how much was observed?)
  const predictionPrecision = predictedPaths.length ? overlap.length / predictedPaths.length : null;

  // ─── Usage ────────────────────────────────────────────────────────────────
  const accumulated = usage.filter((row: any) => row.accumulation === "accumulated").at(-1) ?? null;
  const exact = usage.filter((row: any) => row.accumulation === "per_response");

  // ─── Outcome ──────────────────────────────────────────────────────────────
  const testsPassed = tests.length ? tests.every((test: any) => test.status === "passed") : null;

  // ─── Evidence warnings ────────────────────────────────────────────────────
  const warnings: string[] = [
    "Shadow mode did not restrict Codex or inject Continuum prediction content.",
    "Command-inferred paths are not proof that a file was read — they are shell command arguments.",
    "The Codex App Server schema does not expose direct file-read events; directlyObservedReadPaths will always be empty.",
    "Observed-not-predicted paths are additional exploration, not automatically unnecessary.",
    "Continuum packet tokens are estimated; no token-savings claim is made.",
  ];
  if (execution.repository_changed) warnings.push("Repository state changed during execution; external concurrent changes cannot be excluded from App Server evidence alone.");
  if (execution.final_base_commit_hash === "SNAPSHOT_UNAVAILABLE") warnings.push("Final snapshot could not be resolved; snapshot comparison is unavailable.");

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
      directlyObservedReadPaths: [], // Not available in Codex App Server schema
      commandInferredReadPaths,
      searchedPaths,
      searchedSymbols,
      editedPaths,
      diffPaths,
      testRelatedPaths,
      unknownReferencedPaths: [],
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
      predictedNotObserved: predictedPaths.filter((path) => !observed.includes(path)).map((path) => ({ path, evidence: "prediction" })),
      observedNotPredicted: observed.filter((path) => !predictedPaths.includes(path)).map(comparisonItem),
      mandatoryPredictionMisses: mandatoryMisses,
      observationRecall,
      predictionPrecision,
      // v1 compat — were incorrectly labelled; keep with corrected values
      overlapRecall: observationRecall,
      overlapPrecision: predictionPrecision,
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
