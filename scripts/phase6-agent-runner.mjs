#!/usr/bin/env node
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { verifyPhase6Task } from "./phase6-verifier.mjs";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(root, "packages/context-engine/benchmarks/v1");
const cli = join(root, "apps/cli/dist/main.js");
const agy = process.env.AGY_BIN ?? "agy";

const args = process.argv.slice(2);
const value = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const has = (name) => args.includes(name);
const model = value("--model", "gemini-3.8-flash-medium");
const treatment = value("--treatment", "continuum_off");
const taskId = value("--task", "small-local-token-refresh");
const repetitions = Number(value("--repetitions", "1"));
const timeoutText = value("--timeout", "5m");
const execute = has("--execute");
const keep = has("--keep");

if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("--repetitions must be a positive integer");
if (!["continuum_off", "continuum_on"].includes(treatment)) throw new Error("--treatment must be continuum_off or continuum_on");
const timeoutMatch = /^(\d+)(s|m|h)$/.exec(timeoutText);
if (!timeoutMatch) throw new Error("--timeout must use a duration such as 5m or 15m");
const timeoutMs = Number(timeoutMatch[1]) * ({ s: 1_000, m: 60_000, h: 3_600_000 }[timeoutMatch[2]]);

const cases = JSON.parse(await readFile(join(fixtureRoot, "cases.json"), "utf8"));
const task = cases.cases.find((item) => item.id === taskId);
if (!task) throw new Error(`Unknown task: ${taskId}`);

const run = async (command, commandArgs, cwd, options = {}) => {
  const started = performance.now();
  try {
    const result = await exec(command, commandArgs, { cwd, windowsHide: true, maxBuffer: 50 * 1024 * 1024, ...options });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr, durationMs: performance.now() - started };
  } catch (error) {
    return { exitCode: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error), durationMs: performance.now() - started };
  }
};

const hash = (input) => createHash("sha256").update(input).digest("hex");
const parseAgentStream = (stdout) => {
  const events = stdout.split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const terminal = events.find((event) => event.event === "result")?.result;
  const usage = terminal?.usage ?? [...events].reverse().find((event) => event.step_update?.usage)?.step_update?.usage;
  return { eventCount: events.length, toolCallCount: events.filter((event) => event.step_update?.step_type === "tool").length, status: terminal?.status ?? "partial", conversationId: terminal?.conversation_id ?? events.find((event) => event.conversation_id)?.conversation_id, usage: usage ?? null };
};
const git = (cwd, ...commandArgs) => run("git", commandArgs, cwd);
const continuum = (cwd, ...commandArgs) => run(process.execPath, [cli, ...commandArgs], cwd);

const makePrompt = (repository) => [
  "You are participating in a controlled coding-agent benchmark.",
  `Task: ${task.task}`,
  "Implement the requested change in the repository, preserve existing behavior, add or update tests when appropriate, and run the available validation.",
  `Work only in ${repository}`,
  "Do not inspect or modify /home/anti, the benchmark source tree, or any other repository. Do not create dependencies or node_modules; use only the files already in the task repository.",
  "Do not modify files unrelated to the task. At the end, summarize changed files, validation commands, and remaining uncertainty.",
  treatment === "continuum_on" ? "Continuum is in compact treatment mode. Call continuum_start_context_session exactly once with this task and createInitialContext=true. Use the returned initial context, then edit immediately. Do not call broad search, web search, packet, explain, or unrelated exploration tools. Continue only if validation fails or required coverage is missing." : "Do not use any Continuum tools or precomputed Continuum context for this run.",
].join("\n\n");

const runOne = async (repetition) => {
  const scratch = await mkdtemp(join(tmpdir(), "continuum-phase6-"));
  const repository = join(scratch, task.repositoryFixture);
  const prompt = makePrompt(repository);
  const artifactDir = join(scratch, "artifacts");
  await cp(join(fixtureRoot, "repositories", task.repositoryFixture), repository, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await git(repository, "init");
  await git(repository, "config", "user.email", "phase6@continuum.invalid");
  await git(repository, "config", "user.name", "Continuum Phase 6");
  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "phase6 benchmark base");
  const base = await git(repository, "rev-parse", "HEAD");
  const manifest = {
    schemaVersion: "continuum.agent-run-manifest.v1",
    taskId, task: task.task, repositoryFixture: task.repositoryFixture, model, treatment,
    repetition, baseCommit: base.stdout.trim(), promptHash: hash(prompt),
    taskDefinitionHash: hash(JSON.stringify(task)),
    cli: agy, continuumVersion: "source-worktree",
    startedAt: new Date().toISOString(),
    controls: { timeout: timeoutText, freshRepository: true, humanIntervention: false },
  };
  await writeFile(join(artifactDir, "run-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (!execute) {
    await writeFile(join(artifactDir, "prompt.txt"), prompt + "\n");
    console.log(JSON.stringify({ mode: "dry-run", manifest, repository, artifactDir }, null, 2));
    if (!keep) await rm(scratch, { recursive: true, force: true });
    return;
  }

  if (treatment === "continuum_on") {
    const initialized = await continuum(repository, "init", "--non-interactive");
    const indexed = initialized.exitCode === 0 ? await continuum(repository, "index") : initialized;
    const mcp = await run(agy, ["mcp", "add", "--env", "CONTINUUM_MCP_COMPACT=1", "continuum", process.execPath, cli, "mcp"], root);
    const enabled = await run(agy, ["mcp", "enable", "continuum"], root);
    await writeFile(join(artifactDir, "continuum-setup.json"), JSON.stringify({ initialized, indexed, mcp, enabled }, null, 2) + "\n");
  } else {
    await run(agy, ["mcp", "disable", "continuum"], root);
  }
  const before = await git(repository, "status", "--short");
  const agent = await run(agy, ["--model", model, "--mode", "accept-edits", "--dangerously-skip-permissions", "--add-dir", repository, "--output-format", "stream-json", "--print-timeout", timeoutText, `--print=${prompt}`], repository, { timeout: timeoutMs + 30_000 });
  await writeFile(join(artifactDir, "agent-output.jsonl"), agent.stdout);
  await writeFile(join(artifactDir, "agent-stderr.log"), agent.stderr);
  const after = await git(repository, "status", "--short");
  const diff = await git(repository, "diff", "--binary");
  const diffCheck = await git(repository, "diff", "--check");
  await writeFile(join(artifactDir, "git-diff.patch"), diff.stdout);
  const telemetry = parseAgentStream(agent.stdout);
  if (agent.stderr.includes("print timeout")) telemetry.status = "TIMEOUT";
  let continuumSession = null;
  if (treatment === "continuum_on") {
    const listed = await continuum(repository, "session", "list", "--json");
    const sessions = listed.exitCode === 0 ? JSON.parse(listed.stdout).sessions ?? [] : [];
    const match = sessions.find((item) => item.session.task.originalTask === task.task);
    if (match) {
      const report = await continuum(repository, "session", "report", match.session.id, "--json");
      continuumSession = report.exitCode === 0 ? JSON.parse(report.stdout) : { error: report.stderr };
    }
    await run(agy, ["mcp", "disable", "continuum"], root);
    await run(agy, ["mcp", "remove", "continuum"], root);
  }
  const validation = await verifyPhase6Task({ repository, task: { ...task, id: taskId }, status: after.stdout });
  const result = {
    schemaVersion: "continuum.agent-effectiveness-run.v1",
    manifest: { ...manifest, completedAt: new Date().toISOString() },
    agent: { exitCode: agent.exitCode, durationMs: agent.durationMs, ...telemetry },
    git: { before: before.stdout, after: after.stdout, diffCheckExitCode: diffCheck.exitCode, changed: after.stdout.trim().length > 0 },
    validation,
    evidence: { providerUsage: telemetry.usage ? "measured" : "unavailable", providerCost: "not_parsed", context: treatment === "continuum_on" ? "continuum_setup_recorded" : "not_applicable" },
    continuumSession,
  };
  await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ result, artifactDir, repository }, null, 2));
  if (!keep) await rm(scratch, { recursive: true, force: true });
};

for (let repetition = 1; repetition <= repetitions; repetition += 1) await runOne(repetition);
