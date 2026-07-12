/**
 * Run orchestrator — the core of Continuum Observer V1.
 *
 * Coordinates:
 * 1. Repository validation
 * 2. Pre-run git snapshot
 * 3. Optional baseline tests
 * 4. Agent execution (via any AgentAdapter)
 * 5. Event persistence
 * 6. Post-run git snapshot
 * 7. File-delta computation
 * 8. Optional final tests
 * 9. Usage metric storage
 *
 * The orchestrator is adapter-neutral.  It knows nothing about Gemini CLI
 * specifics — those are the adapter's responsibility.
 */

import {
  generateRunId,
  now,
  createLogger,
  normalisePath,
  AgentRunError,
} from "@continuum/shared";
import type {
  AgentAdapter,
  AgentRunInput,
  AgentEvent,
  ContinuumConfig,
  RunStatus,
  OutputMode,
  AttributionConfidence,
} from "@continuum/shared";
import {
  RunRepository,
  RepositoryRepository,
  EventRepository,
  GitSnapshotRepository,
  FileChangeRepository,
  TestRunRepository,
  UsageMetricRepository,
} from "@continuum/database";
import type { Db } from "@continuum/database";
import {
  getRepositoryRoot,
  getCurrentBranch,
  getCurrentCommit,
  captureSnapshot,
  computeDelta,
  extractDirtyPaths,
} from "@continuum/git-analyzer";
import { runTestCommand } from "./test-executor.js";
import { basename } from "node:path";

const log = createLogger("run-orchestrator");

export interface OrchestratorRunOptions {
  task: string;
  adapter: AgentAdapter;
  config: ContinuumConfig;
  db: Db;
  repositoryPath: string;
  runsDir: string;
  timeoutMs?: number;
  additionalArgs?: string[];
  skipBaselineTests?: boolean;
  skipFinalTests?: boolean;
  signal?: AbortSignal;
  unsafeAutoApprove?: boolean;
  initializationTimeoutMs?: number;
  /** Callback to stream events to the terminal. */
  onEvent?: (event: AgentEvent) => void;
}

export interface OrchestratorResult {
  runId: string;
  status: RunStatus;
  exitCode?: number;
  errorSummary?: string;
}

export async function orchestrateRun(
  opts: OrchestratorRunOptions,
): Promise<OrchestratorResult> {
  const runId = generateRunId();
  const repositoryPath = normalisePath(opts.repositoryPath);

  log.info("Orchestrating run", { runId, task: opts.task.slice(0, 80) });

  // Resolve and record the repository
  const repoRoot = await getRepositoryRoot(repositoryPath);
  const repoName = basename(repoRoot);

  const repoRepo = new RepositoryRepository(opts.db);
  const runRepo = new RunRepository(opts.db);
  const eventRepo = new EventRepository(opts.db);
  const gitSnapshotRepo = new GitSnapshotRepository(opts.db);
  const fileChangeRepo = new FileChangeRepository(opts.db);
  const testRunRepo = new TestRunRepository(opts.db);
  const usageRepo = new UsageMetricRepository(opts.db);

  const repositoryRecord = repoRepo.upsert(repoRoot, repoName);

  // Capture pre-run git state
  const branch = await getCurrentBranch(repoRoot);
  const startingCommit = await getCurrentCommit(repoRoot);
  const beforeSnapshot = await captureSnapshot(repoRoot);
  const dirtyPathsBefore = extractDirtyPaths(beforeSnapshot.statusPorcelain);

  // Create the run record
  runRepo.create({
    id: runId,
    repositoryId: repositoryRecord.id,
    agentId: opts.adapter.id,
    task: opts.task,
    branch: branch ?? undefined,
    startingCommit: startingCommit ?? undefined,
  });

  // Persist the before snapshot
  gitSnapshotRepo.insert(
    runId,
    "before",
    beforeSnapshot.commitHash,
    beforeSnapshot.branch,
    beforeSnapshot.statusPorcelain,
    beforeSnapshot.capturedAt,
  );

  // Optional baseline tests
  if (!opts.skipBaselineTests && opts.config.testCommands.length > 0) {
    for (const command of opts.config.testCommands) {
      const result = await runTestCommand({
        command,
        workingDirectory: repoRoot,
        phase: "baseline",
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        runsDir: opts.runsDir,
        runId,
      });
      testRunRepo.insert({
        runId,
        phase: "baseline",
        command: result.command,
        workingDirectory: result.workingDirectory,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        passedCount: result.passedCount,
        failedCount: result.failedCount,
        parseConfidence: result.parseConfidence,
        stdoutPath: result.stdoutPath,
        stderrPath: result.stderrPath,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
      });
    }
  }

  // Run the agent
  const agentInput: AgentRunInput = {
    runId,
    task: opts.task,
    repositoryPath: repoRoot,
    workingDirectory: repoRoot,
    timeoutMs: opts.timeoutMs,
    additionalArgs: opts.additionalArgs,
    signal: opts.signal,
    policy: {
      captureRawOutput: opts.config.captureRawOutput ?? true,
      redactPatterns: opts.config.redactPatterns ?? [],
      unsafeAutoApprove: opts.unsafeAutoApprove ?? false,
      initializationTimeoutMs: opts.initializationTimeoutMs ?? 15000,
    }
  };

  let finalStatus: RunStatus = "running";
  let exitCode: number | undefined;
  let errorSummary: string | undefined;
  let outputMode: OutputMode = "unknown";
  let finalAttributionConfidence: AttributionConfidence = "unknown";
  let toolCallCount = 0;
  let hasTokenUsage = false;

  let terminalEventReceived = false;

  try {
    for await (const event of opts.adapter.run(agentInput)) {
      if (terminalEventReceived) {
        log.warn("Received event after terminal event, ignoring", { runId, eventType: event.eventType });
        continue;
      }

      // Persist event
      eventRepo.insert(event, event.redactionApplied);

      // Stream to terminal
      opts.onEvent?.(event);

      // Track output mode and completion
      if (event.eventType === "run_started") {
        outputMode = event.payload.outputMode as OutputMode;
        // Update run record with command
        opts.db
          .prepare(
            "UPDATE agent_runs SET exact_command = ?, output_mode = ? WHERE id = ?",
          )
          .run(event.payload.command, outputMode, runId);
      }

      if (event.eventType === "tool_call") {
        toolCallCount += 1;
      }

      if (event.eventType === "token_usage") {
        hasTokenUsage = true;
        const payload = event.payload;
        if (payload.inputTokens !== undefined) {
          usageRepo.insert({
            runId,
            metricName: "input_tokens",
            numericValue: payload.inputTokens,
            unit: "tokens",
            source: "adapter",
            quality: "exact",
          });
        }
        if (payload.outputTokens !== undefined) {
          usageRepo.insert({
            runId,
            metricName: "output_tokens",
            numericValue: payload.outputTokens,
            unit: "tokens",
            source: "adapter",
            quality: "exact",
          });
        }
        if (payload.cachedTokens !== undefined) {
          usageRepo.insert({
            runId,
            metricName: "cached_tokens",
            numericValue: payload.cachedTokens,
            unit: "tokens",
            source: "adapter",
            quality: "exact",
          });
        }
      }

      if (event.eventType === "run_completed") {
        finalStatus = "completed";
        exitCode = event.payload.exitCode;
        terminalEventReceived = true;
      }

      if (event.eventType === "run_failed") {
        finalStatus = event.payload.cancelled
          ? "cancelled"
          : event.payload.timedOut
            ? "timed_out"
            : "failed";
        exitCode = event.payload.exitCode;
        errorSummary = event.payload.reason;
        terminalEventReceived = true;
      }
    }
    
    if (!terminalEventReceived) {
      finalStatus = "failed";
      errorSummary = "Adapter ended without emitting a terminal event";
    }
  } catch (err) {
    finalStatus = "failed";
    errorSummary =
      err instanceof Error ? err.message : "Unknown orchestration error";
    throw new AgentRunError(
      errorSummary,
      runId,
      err,
    );
  }

  // Store tool call count
  if (toolCallCount > 0) {
    usageRepo.insert({
      runId,
      metricName: "tool_calls",
      numericValue: toolCallCount,
      unit: "count",
      source: "adapter",
      quality: "exact",
    });
  }

  // Capture post-run git state
  const afterSnapshot = await captureSnapshot(repoRoot);
  gitSnapshotRepo.insert(
    runId,
    "after",
    afterSnapshot.commitHash,
    afterSnapshot.branch,
    afterSnapshot.statusPorcelain,
    afterSnapshot.capturedAt,
  );

  // Compute file-level deltas with attribution
  const deltas = await computeDelta(
    repoRoot,
    beforeSnapshot,
    afterSnapshot,
    dirtyPathsBefore,
  );

  if (deltas.length > 0) {
    fileChangeRepo.insertBatch(
      runId,
      deltas.map((d) => ({
        pathBefore: d.pathBefore,
        pathAfter: d.pathAfter,
        changeType: d.changeType,
        additions: d.additions,
        deletions: d.deletions,
        binary: d.binary,
        attributionConfidence: d.attributionConfidence,
      })),
    );

    // Overall attribution confidence = worst-case across all files
    const hasLow = deltas.some((d) => d.attributionConfidence === "low");
    const hasMedium = deltas.some(
      (d) => d.attributionConfidence === "medium",
    );
    finalAttributionConfidence = hasLow
      ? "low"
      : hasMedium
        ? "medium"
        : "high";
  }

  // Optional final tests
  if (
    !opts.skipFinalTests &&
    opts.config.testCommands.length > 0 &&
    finalStatus !== "cancelled"
  ) {
    for (const command of opts.config.testCommands) {
      const result = await runTestCommand({
        command,
        workingDirectory: repoRoot,
        phase: "final",
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        runsDir: opts.runsDir,
        runId,
      });
      testRunRepo.insert({
        runId,
        phase: "final",
        command: result.command,
        workingDirectory: result.workingDirectory,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        passedCount: result.passedCount,
        failedCount: result.failedCount,
        parseConfidence: result.parseConfidence,
        stdoutPath: result.stdoutPath,
        stderrPath: result.stderrPath,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
      });
    }
  }

  // Finalise the run record
  const endingCommit = await getCurrentCommit(repoRoot);
  runRepo.finish({
    id: runId,
    status: finalStatus,
    endingCommit: endingCommit ?? undefined,
    exitCode,
    errorSummary,
    outputMode,
    attributionConfidence: finalAttributionConfidence,
  });

  log.info("Run complete", {
    runId,
    status: finalStatus,
    exitCode,
    toolCallCount,
    hasTokenUsage,
    fileChanges: deltas.length,
  });

  return { runId, status: finalStatus, exitCode, errorSummary };
}
