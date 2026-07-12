#!/usr/bin/env node
/**
 * Continuum CLI entry point.
 */

import { Command } from "commander";
import { runDoctorCommand } from "./commands/doctor.js";
import { runInitCommand } from "./commands/init.js";
import { runRunCommand } from "./commands/run.js";
import { runReportCommand } from "./commands/report.js";
import { runOutcomeCommand } from "./commands/outcome.js";
import { runCompareCommand } from "./commands/compare.js";
import { runIndexCommand } from "./commands/index-repo.js";
import { runContextCommand } from "./commands/context.js";
import { runMcpCommand } from "./commands/mcp.js";
import { printError } from "./display.js";

const program = new Command();

program
  .name("continuum")
  .description(
    "Vendor-neutral context observability and optimisation system for AI coding agents.",
  )
  .version("0.1.0");

// doctor
program
  .command("doctor")
  .description("Check your Continuum environment and dependencies.")
  .action(async () => {
    await runDoctorCommand({ cwd: process.cwd() });
  });

// init
program
  .command("init")
  .description("Initialise Continuum in the current repository.")
  .option("--non-interactive", "Skip interactive prompts and use defaults.")
  .action(async (options: { nonInteractive?: boolean }) => {
    await runInitCommand({
      cwd: process.cwd(),
      nonInteractive: options.nonInteractive,
    });
  });

// run
program
  .command("run <task>")
  .description("Run a coding agent task and record observations.")
  .option("--agent <id>", "Agent adapter to use.", "gemini")
  .option("--repo <path>", "Path to the repository (default: cwd).")
  .option("--timeout <duration>", "Timeout for the agent run (e.g. 5m, 300s).")
  .option("--skip-baseline-tests", "Skip running baseline tests before the agent.")
  .option("--skip-final-tests", "Skip running tests after the agent.")
  .option("--non-interactive", "Disable interactive prompts.")
  .option("--unsafe-auto-approve", "Enable unsafe auto-approval of all tools. Warning: use only in trusted/disposable repositories!")
  .allowUnknownOption(true)
  .action(async (task: string, options: {
    agent?: string;
    repo?: string;
    timeout?: string;
    skipBaselineTests?: boolean;
    skipFinalTests?: boolean;
    nonInteractive?: boolean;
    unsafeAutoApprove?: boolean;
  }, cmd: Command) => {
    // Collect any arguments after -- as additional agent args
    const rawArgs = cmd.args ?? [];
    const separatorIdx = rawArgs.indexOf("--");
    const additionalArgs =
      separatorIdx >= 0 ? rawArgs.slice(separatorIdx + 1) : [];

    await runRunCommand(task, {
      ...options,
      cwd: process.cwd(),
      additionalArgs,
    });
  });

// report
program
  .command("report [run-id]")
  .description(
    'Display a detailed report for a run. Use "latest" or omit to see the most recent run.',
  )
  .option("--repo <path>", "Path to the repository (default: cwd).")
  .action(async (runId: string | undefined, options: { repo?: string }) => {
    await runReportCommand(runId, { cwd: process.cwd(), ...options });
  });

// outcome
program
  .command("outcome [run-id]")
  .description(
    'Record a user outcome for a run. Use "latest" or omit for most recent.',
  )
  .option("--non-interactive", "Default to unknown outcome without prompts.")
  .action(async (runId: string | undefined, options: { nonInteractive?: boolean }) => {
    await runOutcomeCommand(runId, {
      cwd: process.cwd(),
      nonInteractive: options.nonInteractive,
    });
  });

// compare
program
  .command("compare <run1> <run2>")
  .description("Compare two runs side-by-side.")
  .action(async (run1: string, run2: string) => {
    await runCompareCommand(run1, run2, { cwd: process.cwd() });
  });

program
  .command("index [dir]")
  .description("Index the repository for context retrieval.")
  .action(async (dir?: string) => {
    await runIndexCommand({ cwd: process.cwd(), dir });
  });

program
  .command("context <query>")
  .description("Retrieve context for a query.")
  .option("--repo <path>", "Path to the repository (default: cwd).")
  .action(async (query: string, options: { repo?: string }) => {
    await runContextCommand(query, { cwd: process.cwd(), repo: options.repo });
  });

program
  .command("mcp")
  .description("Start the Continuum MCP stdio server.")
  .action(async () => {
    await runMcpCommand({ cwd: process.cwd() });
  });

// Global error handling
program.exitOverride((err) => {
  if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
    process.exit(0);
  }
  printError(err.message);
  process.exit(err.exitCode ?? 1);
});

// Parse
program.parseAsync(process.argv).catch((err: unknown) => {
  printError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
