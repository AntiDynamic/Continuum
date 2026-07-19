/**
 * Report builder.
 *
 * Assembles a RunReport from database evidence.  All metrics are labelled
 * with their quality level so the CLI can present them honestly.
 *
 * Design rules:
 * - Never invent or approximate a metric that was not emitted.
 * - Never label a heuristic as "exact".
 * - Keep correctness and efficiency separate.
 * - List all unavailable metrics explicitly.
 */

import type {
  AgentRunRow,
  GitSnapshotRow,
  FileChangeRow,
  TestRunRow,
  UsageMetricRow,
  UserOutcomeRow,
} from "@continuum/database";
import {
  RunRepository,
  RepositoryRepository,
  EventRepository,
  GitSnapshotRepository,
  FileChangeRepository,
  TestRunRepository,
  UsageMetricRepository,
  UserOutcomeRepository,
  UsageEvidenceRepository,
  CostEvidenceRepository,
  ContextLedgerRepository,
} from "@continuum/database";
import type { Db } from "@continuum/database";
import type { StoredUsageEvidence } from "@continuum/database";
import { RunNotFoundError, formatDuration } from "@continuum/shared";
import type {
  ContextPacketTokenAccounting,
  MetricQuality,
  RunContextLedgerEntry,
  RunCostEvidence,
} from "@continuum/shared";

export interface MetricValue {
  name: string;
  value: string | number | null;
  quality: MetricQuality | "unavailable";
  unit?: string;
  note?: string;
}

export interface TestSummary {
  phase: string;
  command: string;
  exitCode: number | null;
  passed?: number;
  failed?: number;
  parseConfidence: string;
  durationMs: number | null;
  timedOut: boolean;
  cancelled: boolean;
}

export interface RunContextSessionSummary {
  sessionId: string;
  strategyId: string;
  strategyVersion: string;
  snapshot: { snapshot_kind: "commit" | "worktree"; base_commit_hash: string; worktree_hash: string | null; dirty: boolean };
  initialEstimatedTokens: number;
  escalationEstimatedTokens: number;
  deliveryCount: number;
  activeReferenceCount: number;
  estimatedDuplicateTokensAvoided: number;
  coverageRemaining: string[];
  state: string;
}

export interface RunReport {
  runId: string;
  task: string;
  agentId: string;
  agentVersion: string | null;
  status: string;
  outputMode: string;
  branch: string | null;
  startingCommit: string | null;
  endingCommit: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  durationFormatted: string | null;
  exitCode: number | null;

  baselineTests: TestSummary[];
  finalTests: TestSummary[];

  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  filesRenamed: number;
  totalAdditions: number;
  totalDeletions: number;
  fileChanges: FileChangeRow[];

  metrics: MetricValue[];
  unavailableMetrics: string[];
  warnings: string[];

  userOutcome: UserOutcomeRow | null;
  totalEvents: number;
  attributionConfidence: string;

  evidencePaths: string[];
  usageEvidence: StoredUsageEvidence | null;
  costEvidence: RunCostEvidence;
  contextLedger: RunContextLedgerEntry[];
  contextPacketAccounting: ContextPacketTokenAccounting[];
  contextSession: RunContextSessionSummary | null;

}

function makeMetric(
  name: string,
  value: string | number | null,
  quality: MetricValue["quality"],
  unit?: string,
  note?: string,
): MetricValue {
  return { name, value, quality, unit, note };
}

export function buildReport(runId: string, db: Db): RunReport {
  const runRepo = new RunRepository(db);
  const repoRepo = new RepositoryRepository(db);
  const eventRepo = new EventRepository(db);
  const gitRepo = new GitSnapshotRepository(db);
  const fileRepo = new FileChangeRepository(db);
  const testRepo = new TestRunRepository(db);
  const usageRepo = new UsageMetricRepository(db);
  const outcomeRepo = new UserOutcomeRepository(db);
  const usageEvidenceRepo = new UsageEvidenceRepository(db);
  const costRepo = new CostEvidenceRepository(db);
  const ledgerRepo = new ContextLedgerRepository(db);

  const run = runRepo.findById(runId);
  if (!run) {
    throw new RunNotFoundError(runId);
  }

  const repository = repoRepo.findByPath(
    db.prepare("SELECT canonical_path FROM repositories WHERE id = ?").get(run.repository_id) as
      | { canonical_path: string }
      | undefined
      ? (
          db
            .prepare("SELECT canonical_path FROM repositories WHERE id = ?")
            .get(run.repository_id) as { canonical_path: string }
        ).canonical_path
      : "",
  );

  const snapshots = gitRepo.findByRunId(runId);
  const fileChanges = fileRepo.findByRunId(runId);
  const testRuns = testRepo.findByRunId(runId);
  const usageMetrics = usageRepo.findByRunId(runId);
  const userOutcome = outcomeRepo.findByRunId(runId);
  const totalEvents = eventRepo.countByRunId(runId);
  const usageEvidence = usageEvidenceRepo.findByRunId(runId);
  const unavailableUsage = { measurement: "unavailable" as const };
  const costEvidence: RunCostEvidence =
    costRepo.findByRunId(runId, usageEvidence?.usage ?? unavailableUsage) ?? {
      runId,
      usage: usageEvidence?.usage ?? unavailableUsage,
      measurement: "unavailable" as const,
    };
  const contextLedger = ledgerRepo.findByRunId(runId);
  const contextPacketAccounting = ledgerRepo.getPacketAccounting(runId);
  const linkedSession = db.prepare(
    "SELECT * FROM context_sessions WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
  ).get(runId) as {
    id: string; strategy_id: string; strategy_version: string;
    snapshot_kind: "commit" | "worktree"; base_commit_hash: string;
    worktree_hash: string | null; status: string;
  } | undefined;
  const contextSession: RunContextSessionSummary | null = linkedSession
    ? (() => {
        const deliveries = db.prepare(
          "SELECT id, stage, estimated_new_tokens, estimated_restored_tokens, estimated_duplicate_tokens_avoided, coverage_remaining_json FROM context_session_deliveries WHERE session_id = ? ORDER BY sequence_number",
        ).all(linkedSession.id) as unknown as {
          id: string; stage: string; estimated_new_tokens: number;
          estimated_restored_tokens: number; estimated_duplicate_tokens_avoided: number;
          coverage_remaining_json: string;
        }[];
        const activeReferenceCount = deliveries.reduce((total, delivery) => total + (
          db.prepare("SELECT COUNT(*) AS n FROM context_session_delivery_items WHERE delivery_id = ? AND delivery_role = 'active_reference'")
            .get(delivery.id) as { n: number }
        ).n, 0);
        const tokens = (stage: string) => deliveries.filter((delivery) => delivery.stage === stage)
          .reduce((total, delivery) => total + delivery.estimated_new_tokens + delivery.estimated_restored_tokens, 0);
        return {
          sessionId: linkedSession.id,
          strategyId: linkedSession.strategy_id,
          strategyVersion: linkedSession.strategy_version,
          snapshot: {
            snapshot_kind: linkedSession.snapshot_kind,
            base_commit_hash: linkedSession.base_commit_hash,
            worktree_hash: linkedSession.worktree_hash,
            dirty: linkedSession.snapshot_kind === "worktree",
          },
          initialEstimatedTokens: tokens("orientation"),
          escalationEstimatedTokens: tokens("escalation"),
          deliveryCount: deliveries.length,
          activeReferenceCount,
          estimatedDuplicateTokensAvoided: deliveries.reduce((total, delivery) => total + delivery.estimated_duplicate_tokens_avoided, 0),
          coverageRemaining: deliveries.length > 0
            ? JSON.parse(deliveries.at(-1)!.coverage_remaining_json) as string[]
            : [],
          state: linkedSession.status,
        };
      })()
    : null;

  // Test summaries
  const baselineTests = testRuns
    .filter((t) => t.phase === "baseline")
    .map(formatTestSummary);
  const finalTests = testRuns
    .filter((t) => t.phase === "final")
    .map(formatTestSummary);

  // File change stats
  let filesAdded = 0;
  let filesModified = 0;
  let filesDeleted = 0;
  let filesRenamed = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const fc of fileChanges) {
    switch (fc.change_type) {
      case "added":
      case "untracked":
        filesAdded += 1;
        break;
      case "modified":
        filesModified += 1;
        break;
      case "deleted":
        filesDeleted += 1;
        break;
      case "renamed":
        filesRenamed += 1;
        break;
    }
    totalAdditions += fc.additions ?? 0;
    totalDeletions += fc.deletions ?? 0;
  }

  // Build metrics list — only what is known
  const metrics: MetricValue[] = [];
  const unavailableMetrics: string[] = [];

  // Duration — exact if finishedAt is known
  if (run.duration_ms !== null) {
    metrics.push(makeMetric("Duration", formatDuration(run.duration_ms), "exact", "ms"));
  } else {
    unavailableMetrics.push("Duration");
  }

  // Exit code — exact
  if (run.exit_code !== null) {
    metrics.push(makeMetric("Exit code", run.exit_code, "exact"));
  } else {
    unavailableMetrics.push("Exit code");
  }

  // File counts — derived from git diff
  metrics.push(makeMetric("Files changed", fileChanges.length, "derived"));
  metrics.push(makeMetric("Lines added", totalAdditions, "derived"));
  metrics.push(makeMetric("Lines deleted", totalDeletions, "derived"));

  // Total events
  metrics.push(makeMetric("Total agent events", totalEvents, "exact"));

  // Usage metrics from database
  const metricByName = new Map<string, UsageMetricRow>();
  for (const m of usageMetrics) {
    metricByName.set(m.metric_name, m);
  }

  const inputTokens = metricByName.get("input_tokens");
  const outputTokens = metricByName.get("output_tokens");
  const cachedTokens = metricByName.get("cached_input_tokens") ?? metricByName.get("cached_tokens");
  const toolCalls = metricByName.get("tool_calls");

  if (inputTokens) {
    metrics.push(
      makeMetric("Input tokens", inputTokens.numeric_value, "exact", "tokens"),
    );
  } else {
    unavailableMetrics.push("Input tokens");
  }

  if (outputTokens) {
    metrics.push(
      makeMetric("Output tokens", outputTokens.numeric_value, "exact", "tokens"),
    );
  } else {
    unavailableMetrics.push("Output tokens");
  }

  if (cachedTokens) {
    metrics.push(
      makeMetric(
        "Cached tokens",
        cachedTokens.numeric_value,
        "exact",
        "tokens",
      ),
    );
  }

  if (toolCalls) {
    metrics.push(
      makeMetric("Tool calls", toolCalls.numeric_value, "exact", "count"),
    );
  } else {
    unavailableMetrics.push("Tool calls");
  }

  unavailableMetrics.push("Files read by agent");
  unavailableMetrics.push("Model API calls");

  if (costEvidence.totalCredits !== undefined) {
    metrics.push(
      makeMetric(
        costEvidence.measurement === "estimated"
          ? "Estimated total credits"
          : "Derived total credits",
        costEvidence.totalCredits,
        costEvidence.measurement === "estimated" ? "estimated" : "derived",
        "credits",
      ),
    );
  } else {
    unavailableMetrics.push("Total task cost");
  }

  const contextTokens = contextPacketAccounting.reduce(
    (total, accounting) => total + accounting.newTokensDelivered,
    0,
  );
  const duplicateTokens = contextPacketAccounting.reduce(
    (total, accounting) =>
      total + accounting.potentialDuplicateTokensAvoided,
    0,
  );
  metrics.push(
    makeMetric(
      "Context supplied",
      contextLedger.filter((entry) => entry.suppliedToAgent).length,
      "exact",
      "items",
    ),
  );
  metrics.push(
    makeMetric("Estimated context tokens", contextTokens, "estimated", "tokens"),
  );
  metrics.push(
    makeMetric(
      "Potential duplicate context avoided",
      duplicateTokens,
      "estimated",
      "tokens",
      "No valid baseline",
    ),
  );

  // Warnings
  const warnings: string[] = [];

  const beforeSnapshot = snapshots.find((s) => s.phase === "before");
  const afterSnapshot = snapshots.find((s) => s.phase === "after");

  if (
    beforeSnapshot?.status_porcelain &&
    beforeSnapshot.status_porcelain.includes("? ")
  ) {
    warnings.push(
      "Repository had untracked files before the run. Attribution confidence for new files is MEDIUM.",
    );
  }

  if (run.attribution_confidence === "low") {
    warnings.push(
      "Some changed files had pre-existing uncommitted modifications. " +
        "Attribution confidence is LOW — changes may not be solely due to the agent.",
    );
  }

  if (!userOutcome) {
    warnings.push("No user outcome recorded. Run 'continuum outcome' to label this run.");
  }

  // Evidence paths
  const evidencePaths: string[] = [];
  for (const tr of testRuns) {
    if (tr.stdout_path) evidencePaths.push(tr.stdout_path);
    if (tr.stderr_path) evidencePaths.push(tr.stderr_path);
  }

  return {
    runId,
    task: run.task,
    agentId: run.agent_id,
    agentVersion: run.agent_version,
    status: run.status,
    outputMode: run.output_mode,
    branch: run.branch,
    startingCommit: run.starting_commit,
    endingCommit: run.ending_commit,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    durationMs: run.duration_ms,
    durationFormatted:
      run.duration_ms !== null ? formatDuration(run.duration_ms) : null,
    exitCode: run.exit_code,

    baselineTests,
    finalTests,

    filesAdded,
    filesModified,
    filesDeleted,
    filesRenamed,
    totalAdditions,
    totalDeletions,
    fileChanges,

    metrics,
    unavailableMetrics,
    warnings,

    userOutcome,
    totalEvents,
    attributionConfidence: run.attribution_confidence,

    evidencePaths,
    usageEvidence: usageEvidence ?? null,
    costEvidence,
    contextLedger,
    contextPacketAccounting,
    contextSession,

  };
}

function formatTestSummary(t: TestRunRow): TestSummary {
  return {
    phase: t.phase,
    command: t.command,
    exitCode: t.exit_code,
    passed: t.passed_count ?? undefined,
    failed: t.failed_count ?? undefined,
    parseConfidence: t.parse_confidence,
    durationMs: t.duration_ms,
    timedOut: t.timed_out === 1,
    cancelled: t.cancelled === 1,
  };
}

// ---------------------------------------------------------------------------
// Run comparison
// ---------------------------------------------------------------------------

export interface ComparisonSection {
  category: string;
  runA: string;
  runB: string;
  observation: string;
}

export interface RunComparison {
  runIdA: string;
  runIdB: string;
  correctness: ComparisonSection[];
  efficiency: ComparisonSection[];
  repositoryImpact: ComparisonSection[];
  evidenceCompleteness: ComparisonSection[];
  /** No misleading overall winner in V1. */
  summary: string;
}

function compareTestOutcomes(a: TestSummary[], b: TestSummary[]): string {
  const aFailed = a.reduce(
    (acc, t) => acc + (t.failed ?? (t.exitCode !== 0 ? 1 : 0)),
    0,
  );
  const bFailed = b.reduce(
    (acc, t) => acc + (t.failed ?? (t.exitCode !== 0 ? 1 : 0)),
    0,
  );
  if (aFailed < bFailed) return "Run A has fewer test failures.";
  if (bFailed < aFailed) return "Run B has fewer test failures.";
  if (a.length === 0 && b.length === 0)
    return "No test results available for either run.";
  return "Both runs have similar test outcomes.";
}

export function compareRuns(
  runIdA: string,
  runIdB: string,
  db: Db,
): RunComparison {
  const a = buildReport(runIdA, db);
  const b = buildReport(runIdB, db);

  const correctness: ComparisonSection[] = [
    {
      category: "Completion status",
      runA: a.status,
      runB: b.status,
      observation:
        a.status === "completed" && b.status !== "completed"
          ? "Run A completed; Run B did not."
          : b.status === "completed" && a.status !== "completed"
            ? "Run B completed; Run A did not."
            : `Both runs status: ${a.status} / ${b.status}`,
    },
    {
      category: "Final tests",
      runA:
        a.finalTests.length > 0
          ? `${a.finalTests[0]?.exitCode === 0 ? "passed" : "failed"}`
          : "no tests",
      runB:
        b.finalTests.length > 0
          ? `${b.finalTests[0]?.exitCode === 0 ? "passed" : "failed"}`
          : "no tests",
      observation: compareTestOutcomes(a.finalTests, b.finalTests),
    },
    {
      category: "User outcome",
      runA: a.userOutcome?.status ?? "unknown",
      runB: b.userOutcome?.status ?? "unknown",
      observation:
        !a.userOutcome && !b.userOutcome
          ? "No user outcome recorded for either run."
          : a.userOutcome?.status === "accepted" &&
              b.userOutcome?.status !== "accepted"
            ? "Run A was accepted by the user."
            : b.userOutcome?.status === "accepted" &&
                a.userOutcome?.status !== "accepted"
              ? "Run B was accepted by the user."
              : "User outcomes are comparable.",
    },
    {
      category: "Exit code",
      runA: String(a.exitCode ?? "unknown"),
      runB: String(b.exitCode ?? "unknown"),
      observation:
        a.exitCode === 0 && b.exitCode !== 0
          ? "Run A exited successfully; Run B did not."
          : b.exitCode === 0 && a.exitCode !== 0
            ? "Run B exited successfully; Run A did not."
            : "Exit codes are comparable.",
    },
  ];

  const efficiency: ComparisonSection[] = [
    {
      category: "Duration",
      runA: a.durationFormatted ?? "unavailable",
      runB: b.durationFormatted ?? "unavailable",
      observation:
        a.durationMs !== null && b.durationMs !== null
          ? a.durationMs < b.durationMs
            ? `Run A was ${formatDuration(b.durationMs - a.durationMs)} faster. [exact]`
            : b.durationMs < a.durationMs
              ? `Run B was ${formatDuration(a.durationMs - b.durationMs)} faster. [exact]`
              : "Both runs took similar time."
          : "Duration unavailable for one or both runs.",
    },
    {
      category: "Input tokens",
      runA:
        a.metrics.find((m) => m.name === "Input tokens")?.value?.toString() ??
        "unavailable",
      runB:
        b.metrics.find((m) => m.name === "Input tokens")?.value?.toString() ??
        "unavailable",
      observation: (() => {
        const aT = a.metrics.find((m) => m.name === "Input tokens");
        const bT = b.metrics.find((m) => m.name === "Input tokens");
        if (!aT || !bT) return "Token data unavailable for one or both runs.";
        const aV = Number(aT.value);
        const bV = Number(bT.value);
        return aV < bV
          ? `Run A used ${(bV - aV).toString()} fewer input tokens. [exact]`
          : bV < aV
            ? `Run B used ${(aV - bV).toString()} fewer input tokens. [exact]`
            : "Token usage is identical.";
      })(),
    },
    {
      category: "Tool calls",
      runA:
        a.metrics.find((m) => m.name === "Tool calls")?.value?.toString() ??
        "unavailable",
      runB:
        b.metrics.find((m) => m.name === "Tool calls")?.value?.toString() ??
        "unavailable",
      observation: (() => {
        const aT = a.metrics.find((m) => m.name === "Tool calls");
        const bT = b.metrics.find((m) => m.name === "Tool calls");
        if (!aT || !bT) return "Tool call data unavailable.";
        return `${aT.value?.toString() ?? "?"} vs ${bT.value?.toString() ?? "?"} tool calls.`;
      })(),
    },
    {
      category: "Cached-input tokens",
      runA: a.usageEvidence?.usage.cachedInputTokens?.toString() ?? "unavailable",
      runB: b.usageEvidence?.usage.cachedInputTokens?.toString() ?? "unavailable",
      observation: "Values retain their usage evidence labels.",
    },
    {
      category: "Output tokens",
      runA: a.usageEvidence?.usage.outputTokens?.toString() ?? "unavailable",
      runB: b.usageEvidence?.usage.outputTokens?.toString() ?? "unavailable",
      observation: "Values retain their usage evidence labels.",
    },
    {
      category: "Total credits",
      runA: a.costEvidence.totalCredits?.toString() ?? "unavailable",
      runB: b.costEvidence.totalCredits?.toString() ?? "unavailable",
      observation:
        a.costEvidence.totalCredits === undefined ||
        b.costEvidence.totalCredits === undefined
          ? "Cost evidence unavailable for one or both runs."
          : a.costEvidence.totalCredits < b.costEvidence.totalCredits
            ? `Run A used fewer ${a.costEvidence.measurement} credits.`
            : b.costEvidence.totalCredits < a.costEvidence.totalCredits
              ? `Run B used fewer ${b.costEvidence.measurement} credits.`
              : "Total credits are equal.",
    },
    {
      category: "Context supplied",
      runA: String(a.contextLedger.filter((entry) => entry.suppliedToAgent).length),
      runB: String(b.contextLedger.filter((entry) => entry.suppliedToAgent).length),
      observation: "Counts ledgered items actually supplied to the agent.",
    },
    {
      category: "Context packet size",
      runA: String(a.contextPacketAccounting.reduce((sum, item) => sum + item.newTokensDelivered, 0)),
      runB: String(b.contextPacketAccounting.reduce((sum, item) => sum + item.newTokensDelivered, 0)),
      observation: "Packet sizes are deterministic token estimates.",
    },
    {
      category: "Context delivery stages",
      runA: [...new Set(a.contextLedger.map((entry) => entry.stage))].join(", ") || "none",
      runB: [...new Set(b.contextLedger.map((entry) => entry.stage))].join(", ") || "none",
      observation: "Stages are reported separately; they are not collapsed into a score.",
    },
    {
      category: "Retries",
      runA: "unavailable",
      runB: "unavailable",
      observation: "Retry evidence is not emitted by current adapters.",
    },
  ];

  const repositoryImpact: ComparisonSection[] = [
    {
      category: "Files changed",
      runA: String(a.fileChanges.length),
      runB: String(b.fileChanges.length),
      observation:
        a.fileChanges.length === b.fileChanges.length
          ? "Both runs changed the same number of files."
          : a.fileChanges.length < b.fileChanges.length
            ? `Run A changed fewer files (${a.fileChanges.length.toString()} vs ${b.fileChanges.length.toString()}). [derived]`
            : `Run B changed fewer files (${b.fileChanges.length.toString()} vs ${a.fileChanges.length.toString()}). [derived]`,
    },
    {
      category: "Lines added",
      runA: String(a.totalAdditions),
      runB: String(b.totalAdditions),
      observation: `Diff sizes: +${a.totalAdditions.toString()} vs +${b.totalAdditions.toString()} lines. [derived]`,
    },
    {
      category: "Attribution confidence",
      runA: a.attributionConfidence,
      runB: b.attributionConfidence,
      observation:
        "Attribution confidence reflects how much pre-existing dirty state existed before each run.",
    },
    {
      category: "Unrelated changes",
      runA:
        a.userOutcome?.unrelated_changes_observed === 1 ? "observed" : "not observed",
      runB:
        b.userOutcome?.unrelated_changes_observed === 1 ? "observed" : "not observed",
      observation: "This dimension depends on recorded developer outcome evidence.",
    },
  ];

  const evidenceCompleteness: ComparisonSection[] = [
    {
      category: "Agent events",
      runA: String(a.totalEvents),
      runB: String(b.totalEvents),
      observation: `${a.totalEvents.toString()} vs ${b.totalEvents.toString()} recorded events.`,
    },
    {
      category: "Token metrics",
      runA: a.metrics.some((m) => m.name === "Input tokens") ? "available" : "unavailable",
      runB: b.metrics.some((m) => m.name === "Input tokens") ? "available" : "unavailable",
      observation: "Token availability depends on the output mode used.",
    },
    {
      category: "User outcome",
      runA: a.userOutcome ? "recorded" : "missing",
      runB: b.userOutcome ? "recorded" : "missing",
      observation: "User outcomes improve comparison reliability.",
    },
  ];

  // Summary — honest, no invented winner
  const statements: string[] = [];
  const aCompleted = a.status === "completed";
  const bCompleted = b.status === "completed";

  if (aCompleted && !bCompleted) {
    statements.push("Run A has stronger completion evidence.");
  } else if (bCompleted && !aCompleted) {
    statements.push("Run B has stronger completion evidence.");
  }

  const aAccepted = a.userOutcome?.status === "accepted";
  const bAccepted = b.userOutcome?.status === "accepted";

  if (aAccepted && !bAccepted) {
    statements.push("Run A was accepted by the user; Run B was not.");
  } else if (bAccepted && !aAccepted) {
    statements.push("Run B was accepted by the user; Run A was not.");
  }

  if (
    a.durationMs !== null &&
    b.durationMs !== null &&
    a.durationMs < b.durationMs
  ) {
    statements.push(
      `Run A was faster (${formatDuration(a.durationMs)} vs ${formatDuration(b.durationMs)}).`,
    );
  } else if (
    a.durationMs !== null &&
    b.durationMs !== null &&
    b.durationMs < a.durationMs
  ) {
    statements.push(
      `Run B was faster (${formatDuration(b.durationMs)} vs ${formatDuration(a.durationMs)}).`,
    );
  }

  if (
    a.costEvidence.totalCredits !== undefined &&
    b.costEvidence.totalCredits !== undefined
  ) {
    if (a.costEvidence.totalCredits < b.costEvidence.totalCredits) {
      statements.push("Run A used fewer evidence-labelled credits.");
    } else if (b.costEvidence.totalCredits < a.costEvidence.totalCredits) {
      statements.push("Run B used fewer evidence-labelled credits.");
    }
  }

  const aContext = a.contextPacketAccounting.reduce(
    (sum, item) => sum + item.newTokensDelivered,
    0,
  );
  const bContext = b.contextPacketAccounting.reduce(
    (sum, item) => sum + item.newTokensDelivered,
    0,
  );
  if (aContext < bContext) {
    statements.push("Run A supplied less estimated context.");
  } else if (bContext < aContext) {
    statements.push("Run B supplied less estimated context.");
  }

  if (statements.length === 0) {
    statements.push("Insufficient evidence to meaningfully distinguish these runs.");
  }

  statements.push(
    "No overall winner can be determined without complete evidence across correctness and efficiency.",
  );

  return {
    runIdA,
    runIdB,
    correctness,
    efficiency,
    repositoryImpact,
    evidenceCompleteness,
    summary: statements.join(" "),
  };
}
