/**
 * continuum run "<task>" — execute a coding agent and record the run.
 */

import { resolve } from "node:path";
import {
  getRepositoryRoot,
  isGitRepository,
} from "@continuum/git-analyzer";
import { openDatabase, migrate } from "@continuum/database";
import { GeminiAdapter } from "@continuum/gemini-adapter";
import { orchestrateRun } from "@continuum/agent-core";
import { buildReport } from "@continuum/evaluator";
import {
  parseDurationMs,
  NotInitialisedError,
} from "@continuum/shared";
import type { AgentEvent } from "@continuum/shared";
import {
  line, blank, section, bold, dim, kv, pass, fail, warn, info,
  printError, green, red, yellow, cyan
} from "../display.js";
import {
  loadConfig,
  getDbPath,
  getRunsDir,
  isInitialised,
} from "../config-helpers.js";
import { printReport } from "./report.js";

function formatEventForTerminal(event: AgentEvent): void {
  switch (event.eventType) {
    case "agent_message":
      line(event.payload.text);
      break;
    case "tool_call":
      line(dim(`  → ${event.payload.toolName}(${JSON.stringify(event.payload.input).slice(0, 80)})`));
      break;
    case "tool_result":
      if (event.payload.exitCode !== undefined) {
        line(
          dim(
            `  ← ${event.payload.toolName ?? "tool"} [exit ${event.payload.exitCode.toString()}]`,
          ),
        );
      }
      break;
    case "stderr":
      process.stderr.write(dim(`[stderr] ${event.payload.line}\n`));
      break;
    case "stdout":
      // Raw unparsed stdout — only show if it looks like useful text
      if (!event.payload.parseError) {
        line(dim(event.payload.line ?? ""));
      }
      break;
    case "token_usage":
      // Shown in final report
      break;
    case "run_completed":
      blank();
      pass(
        `Agent completed`,
        `exit code ${event.payload.exitCode.toString()}, ${Math.round(event.payload.durationMs / 1000).toString()}s`,
      );
      break;
    case "run_failed":
      blank();
      fail(
        `Agent failed: ${event.payload.reason}`,
        event.payload.timedOut
          ? "timed out"
          : event.payload.cancelled
            ? "cancelled"
            : "error",
      );
      break;
    default:
      break;
  }
}

export interface RunCommandOptions {
  agent?: string;
  repo?: string;
  timeout?: string;
  skipBaselineTests?: boolean;
  skipFinalTests?: boolean;
  nonInteractive?: boolean;
  unsafeAutoApprove?: boolean;
  cwd?: string;
  additionalArgs?: string[];
}

export async function runRunCommand(
  task: string,
  options: RunCommandOptions,
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const repoPath = options.repo ? resolve(options.repo) : cwd;

  // Validate repository
  const isGit = await isGitRepository(repoPath);
  if (!isGit) {
    printError(`"${repoPath}" is not inside a Git repository.`);
    process.exit(1);
  }

  const repoRoot = await getRepositoryRoot(repoPath);

  if (!(await isInitialised(repoRoot))) {
    printError(`Continuum is not initialised. Run "continuum init" first.`);
    process.exit(1);
  }

  const config = await loadConfig(repoRoot);
  const db = openDatabase(getDbPath(repoRoot));
  migrate(db);

  const agentId = options.agent ?? config.defaultAgent;
  let adapter: import("@continuum/shared").AgentAdapter;

  if (agentId === "gemini") {
    adapter = new GeminiAdapter();

    // Check Gemini is available
    const availability = await adapter.detectAvailability();
    if (!availability.available) {
      db.close();
      printError(
        `Gemini CLI is not available: ${availability.reason ?? "not found"}. ` +
          "Install with: npm install -g @google/gemini-cli@latest",
      );
      process.exit(1);
    }
  } else {
    db.close();
    printError(`Unknown agent: "${agentId}". Supported agents: gemini`);
    process.exit(1);
  }

  const timeoutMs = options.timeout
    ? parseDurationMs(options.timeout)
    : undefined;

  // Set up Ctrl+C cancellation
  const controller = new AbortController();
  const cancelHandler = () => {
    blank();
    warn("Cancelling run... (Ctrl+C again to force exit)");
    controller.abort();
    // Second Ctrl+C → force exit
    process.once("SIGINT", () => {
      process.exit(130);
    });
  };
  process.once("SIGINT", cancelHandler);

  blank();
  line(bold("Continuum Run"));
  blank();
  kv("Task", task);
  kv("Agent", agentId);
  kv("Repository", repoRoot);
  if (config.testCommands.length > 0) {
    kv("Test commands", config.testCommands.join(", "));
  }
  blank();

  try {
    const result = await orchestrateRun({
      task,
      adapter,
      config,
      db,
      repositoryPath: repoRoot,
      runsDir: getRunsDir(repoRoot),
      timeoutMs,
      additionalArgs: options.additionalArgs,
      skipBaselineTests: options.skipBaselineTests,
      skipFinalTests: options.skipFinalTests,
      signal: controller.signal,
      unsafeAutoApprove: options.unsafeAutoApprove,
      onEvent: formatEventForTerminal,
    });

    process.removeListener("SIGINT", cancelHandler);

    blank();
    section("Run complete");
    kv("Run ID", result.runId);
    kv("Status", result.status);

    blank();
    line(dim(`Report: continuum report ${result.runId}`));
    line(dim(`Outcome: continuum outcome ${result.runId}`));
    blank();

    // Show brief report
    const report = buildReport(result.runId, db);

    if (report.finalTests.length > 0) {
      section("Tests");
      for (const t of report.finalTests) {
        if (t.exitCode === 0) {
          pass(
            t.command,
            t.passed !== undefined ? `${t.passed.toString()} passed` : "succeeded",
          );
        } else {
          fail(
            t.command,
            t.failed !== undefined ? `${t.failed.toString()} failed` : `exit code ${t.exitCode?.toString() ?? "?"}`,
          );
        }
      }
    }

    if (report.fileChanges.length > 0) {
      section("File changes");
      for (const fc of report.fileChanges) {
        const path = fc.path_after ?? fc.path_before ?? "unknown";
        const change =
          fc.change_type === "added"
            ? green("+")
            : fc.change_type === "deleted"
              ? red("-")
              : yellow("~");
        line(
          `  ${change}  ${path}  ${fc.additions !== null ? green(`+${String(fc.additions ?? 0)}`) : ""}${fc.deletions !== null ? red(` -${String(fc.deletions ?? 0)}`) : ""}  ${dim(`[${fc.attribution_confidence}]`)}`,
        );
      }
    }

    blank();
  } catch (err) {
    process.removeListener("SIGINT", cancelHandler);
    if (err instanceof Error) {
      printError(err.message);
    }
    process.exit(1);
  } finally {
    db.close();
  }
}
