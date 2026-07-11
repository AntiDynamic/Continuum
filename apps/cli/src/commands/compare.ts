/**
 * continuum compare <run-a> <run-b> — compare two agent runs.
 */

import { resolve } from "node:path";
import { openDatabase, migrate } from "@continuum/database";
import { compareRuns } from "@continuum/evaluator";
import { RunNotFoundError } from "@continuum/shared";
import {
  line, section, blank, kv, bold, dim, printError, info, green, yellow, red
} from "../display.js";
import { getDbPath, isInitialised } from "../config-helpers.js";
import { getRepositoryRoot, isGitRepository } from "@continuum/git-analyzer";

function sectionHeader(title: string, runA: string, runB: string): void {
  blank();
  line(bold(title));
  line("─".repeat(60));
  line(
    `  ${"Category".padEnd(24)}  ${dim("Run A").padEnd(16)}  ${dim("Run B").padEnd(16)}`,
  );
  line("─".repeat(60));
}

export async function runCompareCommand(
  runIdA: string,
  runIdB: string,
  options: { cwd?: string },
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  if (!(await isGitRepository(cwd))) {
    printError("Not inside a Git repository.");
    process.exit(1);
  }

  const repoRoot = await getRepositoryRoot(cwd);

  if (!(await isInitialised(repoRoot))) {
    printError("Continuum is not initialised. Run 'continuum init' first.");
    process.exit(1);
  }

  const db = openDatabase(getDbPath(repoRoot));
  migrate(db);

  try {
    const comparison = compareRuns(runIdA, runIdB, db);

    line(bold("Continuum Compare"));
    blank();
    info("Run A", runIdA);
    info("Run B", runIdB);

    // Correctness
    sectionHeader("Correctness", runIdA, runIdB);
    for (const item of comparison.correctness) {
      line(
        `  ${item.category.padEnd(24)}  ${item.runA.padEnd(16)}  ${item.runB.padEnd(16)}`,
      );
      if (item.observation) {
        line(`  ${dim(item.observation)}`);
      }
    }

    // Efficiency
    sectionHeader("Efficiency", runIdA, runIdB);
    for (const item of comparison.efficiency) {
      line(
        `  ${item.category.padEnd(24)}  ${item.runA.padEnd(16)}  ${item.runB.padEnd(16)}`,
      );
      if (item.observation) {
        line(`  ${dim(item.observation)}`);
      }
    }

    // Repository impact
    sectionHeader("Repository impact", runIdA, runIdB);
    for (const item of comparison.repositoryImpact) {
      line(
        `  ${item.category.padEnd(24)}  ${item.runA.padEnd(16)}  ${item.runB.padEnd(16)}`,
      );
      if (item.observation) {
        line(`  ${dim(item.observation)}`);
      }
    }

    // Evidence completeness
    sectionHeader("Evidence completeness", runIdA, runIdB);
    for (const item of comparison.evidenceCompleteness) {
      line(
        `  ${item.category.padEnd(24)}  ${item.runA.padEnd(16)}  ${item.runB.padEnd(16)}`,
      );
    }

    blank();
    line(bold("Summary"));
    line("─".repeat(60));
    line(`  ${comparison.summary}`);
    blank();

    line(
      dim(
        "Note: No overall winner is declared without complete evidence across all categories.",
      ),
    );
    blank();
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
