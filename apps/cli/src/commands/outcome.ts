/**
 * continuum outcome <run-id|latest> — label the result of an agent run.
 */

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  openDatabase,
  migrate,
  RunRepository,
  UserOutcomeRepository,
} from "@continuum/database";
import { RunNotFoundError, now } from "@continuum/shared";
import type { OutcomeStatus } from "@continuum/shared";
import {
  line, section, blank, kv, bold, dim, pass, printError, info
} from "../display.js";
import {
  getDbPath,
  isInitialised,
} from "../config-helpers.js";
import { getRepositoryRoot, isGitRepository } from "@continuum/git-analyzer";

async function promptChoice<T extends string>(
  question: string,
  choices: T[],
): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const choiceList = choices.map((c, i) => `  ${(i + 1).toString()}. ${c}`).join("\n");
    rl.question(`${question}\n${choiceList}\n> `, (answer) => {
      rl.close();
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < choices.length) {
        resolve(choices[idx] as T);
      } else {
        // Default to first choice on invalid input
        resolve(choices[0] as T);
      }
    });
  });
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N]: `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function promptText(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function runOutcomeCommand(
  runIdOrLatest: string | undefined,
  options: { cwd?: string; nonInteractive?: boolean },
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const repoPath = cwd;

  if (!(await isGitRepository(repoPath))) {
    printError("Not inside a Git repository.");
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
    const runRepo = new RunRepository(db);
    let runId: string;

    if (!runIdOrLatest || runIdOrLatest === "latest") {
      const latest = runRepo.findLatest();
      if (!latest) {
        printError("No runs found.");
        process.exit(1);
      }
      runId = latest.id;
    } else {
      runId = runIdOrLatest;
      const run = runRepo.findById(runId);
      if (!run) {
        throw new RunNotFoundError(runId);
      }
    }

    const run = runRepo.findById(runId);
    if (!run) throw new RunNotFoundError(runId);

    line(bold("Continuum Outcome"));
    blank();
    info("Run", runId);
    info("Task", run.task);
    info("Status", run.status);
    blank();

    const outcomeRepo = new UserOutcomeRepository(db);

    // Check if outcome already recorded
    const existing = outcomeRepo.findByRunId(runId);
    if (existing) {
      info("Existing outcome", existing.status);
      blank();
    }

    let status: OutcomeStatus;
    let requiredCorrections = false;
    let regressionObserved = false;
    let unrelatedChangesObserved = false;
    let solutionReverted = false;
    let notes = "";

    if (options.nonInteractive) {
      // In non-interactive mode, default to unknown
      status = "unknown";
    } else {
      status = await promptChoice<OutcomeStatus>(
        "How would you label this run outcome?",
        ["accepted", "accepted-with-corrections", "rejected", "unknown"],
      );

      blank();
      requiredCorrections = await promptYesNo(
        "Did the solution require manual corrections?",
      );
      regressionObserved = await promptYesNo(
        "Did you observe a regression?",
      );
      unrelatedChangesObserved = await promptYesNo(
        "Were unrelated files modified?",
      );

      if (status === "rejected" || regressionObserved) {
        solutionReverted = await promptYesNo("Was the solution reverted?");
      }

      notes = await promptText("Optional notes (press Enter to skip)");
    }

    outcomeRepo.upsert({
      runId,
      status,
      requiredCorrections,
      regressionObserved,
      unrelatedChangesObserved,
      solutionReverted,
      notes: notes || undefined,
      createdAt: now(),
    });

    blank();
    pass(`Outcome recorded: ${status}`);
    kv("Run", runId);
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
