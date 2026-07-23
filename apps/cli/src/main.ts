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
import { runIndexCommand } from "./commands/index-compiler.js";
import { runContextCommand } from "./commands/context-compiler.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runPricingSetCommand, runPricingShowCommand } from "./commands/pricing.js";
import {
  runSessionComplete, runSessionContext, runSessionList, runSessionReport,
  runSessionRequest, runSessionSignal, runSessionStart, runSessionStatus,
} from "./commands/session.js";
import { printError } from "./display.js";
import { runCodexList, runCodexReport, runCodexShadow, runCodexStatus, runCodexCompare } from "./commands/codex.js";

const program = new Command();
const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

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
  .option("--json", "Emit the structured JSON report model.")
  .option("--html", "Emit a standalone HTML report.")
  .action(async (runId: string | undefined, options: { repo?: string; json?: boolean; html?: boolean }) => {
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

const context = program
  .command("context")
  .description("Search, explain, cover, or pack repository context.");

context
  .command("search <query>")
  .description("Search indexed context without recording a delivery.")
  .option("--repo <path>", "Path to the repository (default: cwd).")
  .option("--json", "Emit structured JSON.")
  .action(async (query: string, options: { repo?: string; json?: boolean }) => {
    await runContextCommand(query, {
      cwd: process.cwd(),
      repo: options.repo,
      mode: "search",
      json: options.json,
    });
  });

context
  .command("pack <query>")
  .description("Build an estimated context packet and optionally ledger it.")
  .option("--repo <path>", "Path to the repository (default: cwd).")
  .option("--run <run-id>", "Run ID or latest for ledger persistence.")
  .option("--json", "Emit structured JSON.")
  .option(
    "--stage <stage>",
    "orientation, implementation, escalation, or restoration.",
    "implementation",
  )
  .action(async (query: string, options: {
    repo?: string;
    run?: string;
    stage: string;
    json?: boolean;
  }) => {
    const stages = [
      "orientation",
      "implementation",
      "escalation",
      "restoration",
    ] as const;
    if (!stages.includes(options.stage as (typeof stages)[number])) {
      throw new Error(`Invalid context delivery stage: ${options.stage}`);
    }
    await runContextCommand(query, {
      cwd: process.cwd(),
      repo: options.repo,
      mode: "pack",
      runId: options.run,
      stage: options.stage as (typeof stages)[number],
      json: options.json,
    });
  });

context
  .command("explain <item-id>")
  .description("Explain one repository-scoped context item.")
  .option("--repo <path>", "Path to the repository (default: cwd).")
  .option("--json", "Emit structured JSON.")
  .action(async (itemId: string, options: { repo?: string; json?: boolean }) => {
    await runContextCommand(itemId, { cwd: process.cwd(), repo: options.repo, mode: "explain", json: options.json });
  });

context
  .command("coverage <task>")
  .description("Analyze required and missing context coverage.")
  .option("--repo <path>", "Path to the repository (default: cwd).")
  .option("--json", "Emit structured JSON.")
  .action(async (task: string, options: { repo?: string; json?: boolean }) => {
    await runContextCommand(task, { cwd: process.cwd(), repo: options.repo, mode: "coverage", json: options.json });
  });

program
  .command("mcp")
  .description("Start the Continuum MCP stdio server.")
  .action(async () => {
    await runMcpCommand({ cwd: process.cwd() });
  });

const session = program.command("session").description("Manage progressive context sessions.");

session.command("start <task>").description("Start a progressive context session.")
  .option("--budget-tokens <number>", "Maximum estimated context-token budget.")
  .option("--run <run-id>", "Run ID or latest.")
  .option("--initial-context", "Create the initial context delivery.")
  .option("--json", "Emit structured JSON.").option("--repo <path>", "Repository path.")
  .action(async (task: string, options: any) => runSessionStart(task, { cwd: process.cwd(), ...options }));

session.command("status <session-id>").description("Show context session status.")
  .option("--json", "Emit structured JSON.").option("--repo <path>", "Repository path.")
  .action(async (id: string, options: any) => runSessionStatus(id, { cwd: process.cwd(), ...options }));

session.command("context <session-id>").description("Get the idempotent initial context delivery.")
  .option("--json", "Emit structured JSON.").option("--repo <path>", "Repository path.")
  .action(async (id: string, options: any) => runSessionContext(id, { cwd: process.cwd(), ...options }));

session.command("request <session-id> <query>").description("Request a progressive context delta.")
  .option("--symbol <symbol>", "Requested symbol.", collect, [])
  .option("--path <path>", "Requested repository path.", collect, [])
  .option("--coverage <category>", "Requested coverage category.", collect, [])
  .option("--json", "Emit structured JSON.").option("--repo <path>", "Repository path.")
  .action(async (id: string, query: string, options: any) => runSessionRequest(id, query, { cwd: process.cwd(), ...options }));

session.command("signal <session-id>").description("Report a typed context-control signal.")
  .requiredOption("--type <type>", "agent-context-request, test-failure, missing-coverage, or out-of-scope-modification.")
  .option("--query <query>", "Agent context request query.")
  .option("--tests <path>", "Failing test path.", collect, [])
  .option("--error <summary>", "Failure summary.")
  .option("--path <path>", "Related path.", collect, [])
  .option("--symbol <symbol>", "Related symbol.", collect, [])
  .option("--coverage <category>", "Missing coverage.", collect, [])
  .option("--modified <path>", "Modified out-of-scope path.", collect, [])
  .option("--predicted <path>", "Predicted path.", collect, [])
  .option("--json", "Emit structured JSON.").option("--repo <path>", "Repository path.")
  .action(async (id: string, options: any) => runSessionSignal(id, { cwd: process.cwd(), ...options }));

session.command("report <session-id>").description("Report persisted context-session evidence.")
  .option("--json", "Emit structured JSON.").option("--repo <path>", "Repository path.")
  .action(async (id: string, options: any) => runSessionReport(id, { cwd: process.cwd(), ...options }));

session.command("complete <session-id>").description("Complete a progressive context session.")
  .requiredOption("--status <status>", "completed, failed, or cancelled.")
  .option("--json", "Emit structured JSON.").option("--repo <path>", "Repository path.")
  .action(async (id: string, options: any) => runSessionComplete(id, { cwd: process.cwd(), ...options }));

session.command("list").description("List recent sessions for this repository.")
  .option("--status <status>", "Filter by status.").option("--limit <number>", "Maximum sessions.")
  .option("--json", "Emit structured JSON.").option("--repo <path>", "Repository path.")
  .action(async (options: any) => runSessionList({ cwd: process.cwd(), ...options }));

const codex = program.command("codex").description("Run Codex in shadow mode, or inspect persisted executions.");

codex.command("run <task>", { hidden: true }).description("Run a Codex execution (shadow or assist).")
  .option("--mode <mode>", "shadow or assist.", "shadow")
  .option("--repo <path>", "Repository path.").option("--model <model>", "Codex model override.")
  .option("--approval-policy <policy>", "untrusted, on-failure, on-request, or never.", "on-request")
  .option("--sandbox <mode>", "read-only, workspace-write, or danger-full-access.", "workspace-write")
  .option("--timeout <duration>", "Turn timeout, for example 5m or 300s.")
  .option("--json", "Emit structured JSON only.").option("--report <path>", "Write the JSON Flight Recorder report.")
  .option("--experimental-raw-usage", "Opt into experimental API raw-response telemetry.")
  .option("--session-budget <integer>", "Assist session estimated-token budget (1900-20000).")
  .option("--max-context-tool-calls <integer>", "Maximum native context-tool calls (1-50).")
  .option("--max-context-result-tokens <integer>", "Maximum estimated tokens per tool result (250-4000).")
  .action(async(task:string,options:any)=>runCodexShadow(task,{cwd:process.cwd(),...options}));

codex.command("compare <task>").description("Run shadow and assist executions sequentially, and compare verification results.")
  .requiredOption("--verifier <command>", "The verification command (e.g. 'pnpm test').")
  .option("--repo <path>", "Repository path.").option("--model <model>", "Codex model override.")
  .option("--timeout <duration>", "Turn timeout, for example 5m or 300s.")
  .option("--json", "Emit structured JSON only.")
  .action(async(task:string,options:any)=>runCodexCompare(task,{cwd:process.cwd(),...options}));

codex.command("report <execution-id>").description("Render a persisted Shadow Flight Recorder report.")
  .option("--repo <path>", "Repository path.").option("--json", "Emit structured JSON only.")
  .action(async(id:string,options:any)=>runCodexReport(id,{cwd:process.cwd(),...options}));
codex.command("status <execution-id>").description("Show one persisted Codex execution.")
  .option("--repo <path>", "Repository path.").option("--json", "Emit structured JSON only.")
  .action(async(id:string,options:any)=>runCodexStatus(id,{cwd:process.cwd(),...options}));
codex.command("list").description("List persisted Codex shadow executions.")
  .option("--repo <path>", "Repository path.").option("--limit <number>", "Maximum executions.").option("--json", "Emit structured JSON only.")
  .action(async(options:any)=>runCodexList({cwd:process.cwd(),...options}));

const pricing = program
  .command("pricing")
  .description("Manage versioned model pricing profiles.");

pricing
  .command("show [model]")
  .description("Show configured pricing profiles.")
  .option("--provider <provider>", "Filter by provider.")
  .action(async (model: string | undefined, options: { provider?: string }) => {
    await runPricingShowCommand(model, {
      cwd: process.cwd(),
      provider: options.provider,
    });
  });

pricing
  .command("set <model>")
  .description("Append a user-configured pricing profile.")
  .requiredOption("--provider <provider>", "Provider identifier.")
  .option("--version <version>", "Pricing or model version label.")
  .option("--input <credits>", "Input credits per million tokens.")
  .option("--cached-input <credits>", "Cached-input credits per million tokens.")
  .option("--output <credits>", "Output credits per million tokens.")
  .option("--effective-from <iso-date>", "ISO-8601 effective timestamp.")
  .action(async (model: string, options: {
    provider: string;
    version?: string;
    input?: string;
    cachedInput?: string;
    output?: string;
    effectiveFrom?: string;
  }) => {
    await runPricingSetCommand(model, {
      cwd: process.cwd(),
      ...options,
    });
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
const contextActions = new Set(["search", "pack", "explain", "coverage"]);
if (process.argv[2] === "context" && process.argv[3] && !process.argv[3].startsWith("-") && !contextActions.has(process.argv[3])) {
  process.argv.splice(3, 0, "search");
}
const codexActions = new Set(["report", "status", "list", "run", "compare"]);
if (process.argv[2] === "codex" && process.argv[3] && !process.argv[3].startsWith("-") && !codexActions.has(process.argv[3])) {
  process.argv.splice(3, 0, "run");
}

program.parseAsync(process.argv).catch((err: unknown) => {
  printError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
