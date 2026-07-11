/**
 * continuum report [run-id|latest] — display an evidence-based run report.
 */

import { resolve } from "node:path";
import { openDatabase, migrate, RunRepository } from "@continuum/database";
import { buildReport } from "@continuum/evaluator";
import type { RunReport, MetricValue } from "@continuum/evaluator";
import { RunNotFoundError } from "@continuum/shared";
import {
  line, section, blank, kv, unavailable, bold, dim, green, red, yellow,
  pass, fail, warn, info, printError
} from "../display.js";
import {
  loadConfig,
  getDbPath,
  isInitialised,
} from "../config-helpers.js";
import { getRepositoryRoot, isGitRepository } from "@continuum/git-analyzer";

function qualityLabel(quality: MetricValue["quality"]): string {
  switch (quality) {
    case "exact": return "";
    case "derived": return "derived";
    case "estimated": return "estimated";
    case "heuristic": return "heuristic";
    case "unavailable": return "unavailable";
  }
}

export async function printReport(report: RunReport): Promise<void> {
  line(bold("Continuum Report"));
  line(dim(`Run: ${report.runId}`));
  blank();

  section("Task");
  line(`  ${report.task}`);

  section("Agent");
  kv("Agent", report.agentId + (report.agentVersion ? ` v${report.agentVersion}` : ""));
  kv("Output mode", report.outputMode);

  section("Status");
  kv("Status", report.status);
  if (report.branch) kv("Branch", report.branch);
  kv("Starting commit", report.startingCommit ?? dim("unavailable"));
  kv("Ending commit", report.endingCommit ?? dim("unavailable"));
  kv("Started", report.startedAt);
  kv("Finished", report.finishedAt ?? dim("running..."));
  kv("Duration", report.durationFormatted ?? dim("unavailable"), "exact");

  if (report.baselineTests.length > 0) {
    section("Baseline tests");
    for (const t of report.baselineTests) {
      if (t.exitCode === 0) {
        pass(t.command, t.passed !== undefined ? `${t.passed.toString()} passed` : "succeeded");
      } else {
        fail(
          t.command,
          t.failed !== undefined
            ? `${t.failed.toString()} failed`
            : `exit code ${t.exitCode?.toString() ?? "?"}`,
        );
      }
    }
  }

  if (report.finalTests.length > 0) {
    section("Final tests");
    for (const t of report.finalTests) {
      if (t.exitCode === 0) {
        pass(t.command, t.passed !== undefined ? `${t.passed.toString()} passed` : "succeeded");
      } else {
        fail(
          t.command,
          t.failed !== undefined
            ? `${t.failed.toString()} failed`
            : `exit code ${t.exitCode?.toString() ?? "?"}`,
        );
      }
    }
  }

  section("File changes");
  if (report.fileChanges.length === 0) {
    kv("No files changed", "");
  } else {
    kv("Files changed", String(report.fileChanges.length), "derived");
    kv("Lines added", String(report.totalAdditions), "derived");
    kv("Lines deleted", String(report.totalDeletions), "derived");
    blank();
    for (const fc of report.fileChanges) {
      const path = fc.path_after ?? fc.path_before ?? "unknown";
      const marker =
        fc.change_type === "added" || fc.change_type === "untracked"
          ? green("  added")
          : fc.change_type === "deleted"
            ? red("deleted")
            : fc.change_type === "renamed"
              ? yellow("renamed")
              : yellow("  modif");
      const additions = fc.additions !== null ? green(`+${String(fc.additions ?? 0)}`) : "";
      const deletions = fc.deletions !== null ? red(`-${String(fc.deletions ?? 0)}`) : "";
      const confidence = dim(`[${fc.attribution_confidence}]`);
      line(
        `  ${marker}  ${path.padEnd(40)}  ${additions.padEnd(8)}${deletions.padEnd(8)} ${confidence}`,
      );
    }
  }

  section("Metrics");
  for (const metric of report.metrics) {
    kv(metric.name, String(metric.value ?? "—"), qualityLabel(metric.quality));
  }
  if (report.unavailableMetrics.length > 0) {
    blank();
    line(dim("  Unavailable metrics:"));
    for (const m of report.unavailableMetrics) {
      unavailable(`  ${m}`);
    }
  }

  kv("Total events", String(report.totalEvents), "exact");
  kv("Attribution confidence", report.attributionConfidence);

  if (report.userOutcome) {
    section("User outcome");
    kv("Status", report.userOutcome.status);
    if (report.userOutcome.required_corrections) kv("Corrections required", "yes");
    if (report.userOutcome.regression_observed) kv("Regression observed", "yes");
    if (report.userOutcome.notes) kv("Notes", report.userOutcome.notes);
  }

  if (report.warnings.length > 0) {
    section("Warnings");
    for (const w of report.warnings) {
      warn(w);
    }
  }

  if (report.evidencePaths.length > 0) {
    section("Evidence");
    for (const p of report.evidencePaths) {
      line(`  ${dim(p)}`);
    }
  }

  blank();
}

export async function runReportCommand(
  runIdOrLatest: string | undefined,
  options: { cwd?: string; repo?: string },
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const repoPath = options.repo ? resolve(options.repo) : cwd;

  if (!(await isGitRepository(repoPath))) {
    printError(`"${repoPath}" is not inside a Git repository.`);
    process.exit(1);
  }

  const repoRoot = await getRepositoryRoot(repoPath);

  if (!(await isInitialised(repoRoot))) {
    printError("Continuum is not initialised. Run 'continuum init' first.");
    process.exit(1);
  }

  const db = openDatabase(getDbPath(repoRoot));
  migrate(db);

  try {
    let runId: string | undefined;

    if (!runIdOrLatest || runIdOrLatest === "latest") {
      const runRepo = new RunRepository(db);
      const latest = runRepo.findLatest();
      if (!latest) {
        printError("No runs found. Run 'continuum run' to start your first run.");
        process.exit(1);
      }
      runId = latest.id;
    } else {
      runId = runIdOrLatest;
    }

    const report = buildReport(runId, db);
    await printReport(report);
  } catch (err) {
    if (err instanceof RunNotFoundError) {
      printError(err.message);
      process.exit(1);
    }
    throw err;
  } finally {
    db.close();
  }
}
