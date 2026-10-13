#!/usr/bin/env node
import { prepareTaskBaseline } from "./phase6-task-setup.mjs";
import { verifyBehavior } from "./phase6-behavior.mjs";
import { parseAgentStream, parseOpenCodeStream, priceProviderUsage } from "./provider-evidence.mjs";
import { openCodeMcpConfiguration } from "./host-config.mjs";
import { redactString, capturePolicyFor } from "../packages/shared/dist/index.js";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { verifyPhase6Task } from "./phase6-verifier.mjs";
import { verifyPhase6HiddenTask } from "./phase6-hidden-verifier.mjs";
import { deriveRunOutcome } from "./phase6-outcome.mjs";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(root, "packages/context-engine/benchmarks/v1");
const cli = join(root, "apps/cli/dist/main.js");
const agy = process.env.AGY_BIN ?? "agy";
const agyHome = process.env.HOME ?? homedir();
const mcpConfigPath = join(agyHome, ".gemini", "config", "mcp_config.json");
const mcpServerName = "continuum";

const args = process.argv.slice(2);
const value = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const has = (name) => args.includes(name);
const agentId = value("--agent", "agy");
const isOpenCode = agentId === "opencode";
const model = value("--model", isOpenCode ? "opencode/big-pickle" : "gemini-3.8-flash-medium");
const treatment = value("--treatment", "continuum_off");
const isPreflight = treatment === "continuum_preflight" || treatment === "continuum_preflight_only";
const mcpEnabled = treatment === "continuum_on" || treatment === "continuum_preflight";
const taskId = value("--task", "small-local-token-refresh");
const repetitions = Number(value("--repetitions", "1"));
const timeoutText = value("--timeout", "5m");
const randomizedOrder = has("--randomized-order");
const execute = has("--execute");
const keep = has("--keep");
const artifactRootArgument = value("--artifact-root", null);
const pricingProfilePath = value("--pricing-profile", process.env.CONTINUUM_PHASE6_PRICING_FILE ?? null);
const agentCommand = isOpenCode ? (process.env.OPENCODE_BIN ?? "opencode") : agy;
const FREE_OPENCODE_MODELS = new Set([
  "opencode/big-pickle",
  "opencode/jev-1.13-free",
  "opencode/ling-3.0-flash-fin-free",
  "opencode/mimo-v2.5-free",
  "opencode/muse-spark-1.2-contributor-free",
  "opencode/muse-spark-1.3-contributor-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/nemotron-3.5-lightning-free",
]);

if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("--repetitions must be a positive integer");
if (!["continuum_off", "continuum_on", "continuum_preflight", "continuum_preflight_only"].includes(treatment)) throw new Error("--treatment must be continuum_off, continuum_on, continuum_preflight, or continuum_preflight_only");
if (!["agy", "opencode"].includes(agentId)) throw new Error("--agent must be agy or opencode");
if (isOpenCode && !FREE_OPENCODE_MODELS.has(model)) throw new Error(`Only allowlisted free OpenCode models may be used: ${[...FREE_OPENCODE_MODELS].join(", ")}`);
const timeoutMatch = /^(\d+)(s|m|h)$/.exec(timeoutText);
if (!timeoutMatch) throw new Error("--timeout must use a duration such as 5m or 15m");
const timeoutMs = Number(timeoutMatch[1]) * ({ s: 1_000, m: 60_000, h: 3_600_000 }[timeoutMatch[2]]);
const artifactRoot = artifactRootArgument ? resolve(artifactRootArgument) : null;
if (artifactRoot) await mkdir(artifactRoot, { recursive: true });

let pricingProfile = null;
if (pricingProfilePath) {
  pricingProfile = JSON.parse(await readFile(resolve(pricingProfilePath), "utf8"));
  for (const field of ["inputPerMillion", "cachedInputPerMillion", "outputPerMillion", "thinkingPerMillion"]) {
    if (pricingProfile[field] !== undefined && (!Number.isFinite(pricingProfile[field]) || pricingProfile[field] < 0)) throw new Error(`Invalid pricing profile field: ${field}`);
  }
}

const cases = JSON.parse(await readFile(join(fixtureRoot, "cases.json"), "utf8"));
const taskSet = JSON.parse(await readFile(join(fixtureRoot, "phase6-tasks.json"), "utf8"));
const taskCase = cases.cases.find((item) => item.id === taskId);
const taskSpec = taskSet.tasks.find((item) => item.id === taskId);
if (!taskCase || !taskSpec) throw new Error(`Unknown task: ${taskId}`);
const task = { ...taskCase, ...taskSpec };

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
const parseAgentOutput = (stdout) => isOpenCode ? parseOpenCodeStream(stdout) : parseAgentStream(stdout);
const deliveryCapabilities = (host, targetedMcp) => ({
  host,
  preflightInjection: true,
  targetedMcp,
  stablePrefixReuse: false,
  explicitPromptCache: false,
  cachedInputTelemetry: true,
  cacheCreationTelemetry: false,
  nativeCompaction: false,
  evidence: "declared",
});
const makeDeliveryReceipt = (host, selectedTreatment, handoff = null, usage = null) => {
  const plan = handoff?.cachePlan ?? null;
  const stablePrefix = plan?.stablePrefix ?? null;
  const taskDelta = plan?.taskDelta ?? null;
  const cacheObservation = usage?.cacheReadTokens > 0 ? "read" : selectedTreatment === "continuum_off" ? "not_requested" : "not_reported";
  return {
    schemaVersion: "continuum.context-delivery-receipt.v1",
    host,
    mode: selectedTreatment === "continuum_off" ? "none" : selectedTreatment === "continuum_preflight" ? "preflight_mcp" : selectedTreatment === "continuum_preflight_only" ? "preflight" : "mcp",
    stablePrefix: { contentHash: stablePrefix?.contentHash ?? null, estimatedTokens: stablePrefix?.estimatedTokens ?? 0, sent: isPreflight, reused: false },
    taskDelta: { contentHash: taskDelta?.contentHash ?? null, estimatedTokens: taskDelta?.estimatedTokens ?? 0, sent: isPreflight },
    cacheObservation,
    providerUsage: usage ? "available" : "unavailable",
    capabilities: deliveryCapabilities(host, selectedTreatment !== "continuum_off" && selectedTreatment !== "continuum_preflight_only"),
  };
};
const classifyAgentFailure = ({ agent, telemetry }) => {
  if (agent.exitCode === 0 && telemetry.status !== "ERROR" && telemetry.status !== "TIMEOUT") return null;
  const text = `${agent.stderr}\n${telemetry.error ?? ""}`.toLowerCase();
  if (/quota|rate limit|too many requests|resource exhausted|limit reached/.test(text)) return "provider_quota";
  if (/authentication|unauthorized|forbidden|sign.?in|credential/.test(text)) return "provider_auth";
  if (/print timeout|deadline exceeded|upstream.*timed out|gateway timeout|\b504\b/.test(text)) return "provider_timeout";
  if (telemetry.status === "TIMEOUT" || /timed out|timeout|print timeout/.test(text) || agent.durationMs >= timeoutMs) return "agent_timeout";
  return "agent_error";
};
const estimateProviderCost = usage => priceProviderUsage(usage, pricingProfile, { provider: agentId, model, observedAt: new Date().toISOString() });
const git = (cwd, ...commandArgs) => run("git", commandArgs, cwd);
const continuum = (cwd, ...commandArgs) => run(process.execPath, [cli, ...commandArgs], cwd);

const readOptional = async (path) => {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};

const mcpServerNames = (content) => {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    return Object.keys(parsed.mcpServers ?? parsed.mcp ?? {}).sort();
  } catch { return []; }
};

const restoreMcpConfig = async (snapshot) => {
  if (snapshot.content === null) {
    await rm(snapshot.path, { force: true });
  } else {
    await mkdir(dirname(snapshot.path), { recursive: true });
    await writeFile(snapshot.path, snapshot.content, "utf8");
  }
};

/**
 * Antigravity stores MCP registrations globally. Snapshot the exact file and
 * restore it after every run so a treatment cannot leak servers or credentials
 * into the next cell. The snapshot contents are never written to artifacts.
 */
const prepareMcpTreatment = async (treatment, artifactDir, repository) => {
  const configPath = isOpenCode ? join(repository, "opencode.json") : mcpConfigPath;
  const original = await readOptional(configPath);
  const snapshot = { path: configPath, content: original };
  const setup = { status: "pending", treatment, agent: agentId, serverName: mcpServerName, configPath, originalExists: original !== null, originalHash: original === null ? null : hash(original), originalServerNames: mcpServerNames(original), commands: [] };
  const record = async (command, commandArgs) => {
    const result = await run(agy, commandArgs, root);
    setup.commands.push({ command, args: commandArgs, exitCode: result.exitCode, durationMs: result.durationMs, stdout: result.stdout.trim(), stderr: result.stderr.trim() });
    return result;
  };

  // Remove any same-name server before configuring the cell. A missing server
  // is harmless; restoration returns the user's original configuration.
  if (isOpenCode) {
    const next = openCodeMcpConfiguration(original, { enabled: mcpEnabled, command: [process.execPath, cli, "mcp"], targeted: treatment === "continuum_preflight" });
    await writeFile(configPath, JSON.stringify(next, null, 2) + "\n");
    const checked = await run(agentCommand, ["mcp", "list"], repository, { timeout: 15000 });
    setup.commands.push({ command: "mcp-list", exitCode: checked.exitCode, stdout: redactString(checked.stdout), stderr: redactString(checked.stderr) });
    setup.commandFailure = checked.exitCode !== 0 || (mcpEnabled && !checked.stdout.includes(mcpServerName));
  } else {
    await record("remove", ["mcp", "remove", mcpServerName]);
    if (mcpEnabled) {
      const envArgs = ["--env", "CONTINUUM_MCP_COMPACT=1"];
      if (treatment === "continuum_preflight") envArgs.push("--env", "CONTINUUM_MCP_TARGETED=1");
      const added = await record("add", ["mcp", "add", ...envArgs, mcpServerName, process.execPath, cli, "mcp"]);
      const enabled = await record("enable", ["mcp", "enable", mcpServerName]);
      setup.commandFailure = added.exitCode !== 0 || enabled.exitCode !== 0;
    }
  }
  const configured = await readOptional(configPath);
  setup.configuredHash = configured === null ? null : hash(configured);
  setup.configuredServerNames = mcpServerNames(configured);
  setup.status = setup.commandFailure || (mcpEnabled && !setup.configuredServerNames.includes(mcpServerName)) || (!mcpEnabled && setup.configuredServerNames.includes(mcpServerName)) ? "failed" : "ready";
  if (setup.status === "failed") setup.error = "MCP registry did not reach the requested treatment state";
  await writeFile(join(artifactDir, "continuum-setup.json"), JSON.stringify(setup, null, 2) + "\n");

  let restored = false;
  return {
    setup,
    async restore() {
      if (restored) return { status: "already_restored" };
      await restoreMcpConfig(snapshot);
      const current = await readOptional(configPath);
      const restoration = {
        status: current === original ? "restored" : "restore_mismatch",
        configPath,
        restoredHash: current === null ? null : hash(current),
        restoredServerNames: mcpServerNames(current),
      };
      await writeFile(join(artifactDir, "continuum-restore.json"), JSON.stringify(restoration, null, 2) + "\n");
      restored = true;
      return restoration;
    },
  };
};

const makePrompt = (repository, preflight = null) => [
  "You are participating in a controlled coding-agent benchmark.",
  `Task: ${task.task}`,
  "Implement the requested change in the repository, preserve existing behavior, add or update tests when appropriate, and run the available validation.",
  `Work only in ${repository}`,
  "Do not inspect or modify /home/anti, the benchmark source tree, or any other repository. Do not create dependencies or node_modules; use only the files already in the task repository.",
  "Do not modify files unrelated to the task. At the end, summarize changed files, validation commands, and remaining uncertainty.",
  `Acceptance criteria:\n${(task.acceptanceCriteria ?? []).map((criterion) => `- ${criterion}`).join("\n") || "- Satisfy the task text and its authored validation contract."}`,
  mcpEnabled ? "Continuum tools are available for relevant context requests. Verify assumptions and use normal repository tools as needed." : "Use normal repository tools to verify assumptions; Continuum MCP is unavailable in this arm.",
  ...(preflight ? ["", preflight] : []),
].join("\n\n");

const runOne = async (repetition) => {
  const scratchParent = artifactRoot ?? tmpdir();
  const scratch = await mkdtemp(join(scratchParent, "continuum-phase6-"));
  const repository = join(scratch, task.repositoryFixture);
  let prompt = makePrompt(repository);
  const artifactDir = join(scratch, "artifacts");
  await cp(join(fixtureRoot, "repositories", task.repositoryFixture), repository, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await prepareTaskBaseline(repository, taskId);
  await git(repository, "init");
  await git(repository, "config", "user.email", "phase6@continuum.invalid");
  await git(repository, "config", "user.name", "Continuum Phase 6");
  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "phase6 benchmark base");
  const base = await git(repository, "rev-parse", "HEAD");
  const manifest = {
    schemaVersion: "continuum.agent-run-manifest.v1",
    taskId, task: task.task, repositoryFixture: task.repositoryFixture, agent: agentId, model, treatment,
    repetition, baseCommit: base.stdout.trim(), promptHash: hash(prompt),
    taskDefinitionHash: hash(JSON.stringify(task)),
    cli: agentCommand, continuumVersion: "source-worktree",
    startedAt: new Date().toISOString(),
    controls: { timeout: timeoutText, freshRepository: true, humanIntervention: false, randomizedOrder, mcpIsolation: "snapshot_restore", pricingProfile: pricingProfile ? { id: pricingProfile.id ?? hash(JSON.stringify(pricingProfile)), path: pricingProfilePath, hash: hash(JSON.stringify(pricingProfile)) } : null },
  };
  await writeFile(join(artifactDir, "run-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (!execute) {
    await writeFile(join(artifactDir, "prompt.txt"), prompt + "\n");
    console.log(JSON.stringify({ mode: "dry-run", manifest, repository, artifactDir }, null, 2));
    if (!keep) await rm(scratch, { recursive: true, force: true });
    return;
  }

  let mcpGuard = null;
  let preflightHandoff = null;
  try {
    let initialized = null;
    let indexed = null;
    if (treatment !== "continuum_off") {
      initialized = await continuum(repository, "init", "--non-interactive");
      indexed = initialized.exitCode === 0 ? await continuum(repository, "index") : initialized;
      await writeFile(join(artifactDir, "continuum-initialization.json"), JSON.stringify({ initialized, indexed }, null, 2) + "\n");
      if (initialized.exitCode !== 0 || indexed.exitCode !== 0) throw new Error("Continuum initialization or indexing failed");
    }
    if (isPreflight) {
      const started = await continuum(repository, "session", "start", task.task, "--initial-context", "--json");
      if (started.exitCode !== 0) throw new Error("Continuum preflight session start failed: " + started.stderr);
      const session = JSON.parse(started.stdout);
      const handoff = await continuum(repository, "session", "handoff", session.session.id, "--json");
      if (handoff.exitCode !== 0) throw new Error("Continuum preflight handoff failed: " + handoff.stderr);
      const payload = JSON.parse(handoff.stdout);
      preflightHandoff = payload;
      await writeFile(join(artifactDir, "continuum-preflight.json"), JSON.stringify({ started: session, handoff: payload }, null, 2) + "\n");
      prompt = makePrompt(repository, payload.prompt);
      manifest.promptHash = hash(prompt);
      await writeFile(join(artifactDir, "run-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    }
    mcpGuard = await prepareMcpTreatment(treatment, artifactDir, repository);
    if (mcpGuard.setup.status !== "ready") throw new Error(mcpGuard.setup.error);
    const before = await git(repository, "status", "--short");
    const beforeHead = await git(repository, "rev-parse", "HEAD");
    const agentArgs = isOpenCode
      ? ["run", "--model", model, "--format", "json", "--dir", repository, "--auto", prompt]
      : ["--model", model, "--mode", "accept-edits", "--dangerously-skip-permissions", "--add-dir", repository, "--output-format", "stream-json", "--print-timeout", timeoutText, `--print=${prompt}`];
    const baselineValidation = await verifyBehavior({repository,taskId,hidden:true});
    if (baselineValidation.status!=="failed") throw new Error("Task baseline does not demonstrate the required defect; refusing effectiveness run.");
    await writeFile(join(artifactDir,"baseline-validation.json"),JSON.stringify(baselineValidation,null,2));
    const agent = await run(agentCommand, agentArgs, repository, { timeout: timeoutMs + 30_000 });
    await writeFile(join(artifactDir, "agent-output.jsonl"),capturePolicyFor(root).captureRawOutput===false?"":redactString(agent.stdout,capturePolicyFor(root).redactPatterns));
    const capture=capturePolicyFor(root);
    await writeFile(join(artifactDir, "agent-stderr.log"),capture.captureRawOutput===false?"":redactString(agent.stderr,capture.redactPatterns));
    const after = await git(repository, "status", "--short");
    const afterHead = await git(repository, "rev-parse", "HEAD");
    const diff = await git(repository, "diff", "--binary");
    const diffStat = await git(repository, "diff", "--stat");
    const diffNames = await git(repository, "diff", "--name-status");
    const untracked = await git(repository, "ls-files", "--others", "--exclude-standard");
    const diffCheck = await git(repository, "diff", "--check");
    const statusPaths = after.stdout.split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1));
    const infrastructurePaths = statusPaths.filter((path) => path === ".gitignore" || path === "opencode.json" || path.startsWith(".continuum/"));
    const relevantPaths = statusPaths.filter((path) => !infrastructurePaths.includes(path));
    await writeFile(join(artifactDir, "git-status-before.txt"), before.stdout);
    await writeFile(join(artifactDir, "git-status-after.txt"), after.stdout);
    await writeFile(join(artifactDir, "git-diff.patch"),capture.captureRawOutput===false?"":redactString(diff.stdout,capture.redactPatterns));
    await writeFile(join(artifactDir, "git-diff-stat.txt"), diffStat.stdout);
    await writeFile(join(artifactDir, "git-diff-name-status.txt"), diffNames.stdout);
    await writeFile(join(artifactDir, "git-untracked.txt"), untracked.stdout);
    const telemetry = parseAgentOutput(agent.stdout);
    if (agent.stderr.includes("print timeout")) telemetry.status = "TIMEOUT";
    const failureCategory = classifyAgentFailure({ agent, telemetry });
    const providerCost = estimateProviderCost(telemetry.usage);
    const deliveryReceipt = makeDeliveryReceipt(isOpenCode ? "opencode" : "antigravity", treatment, preflightHandoff, telemetry.usage);
    await writeFile(join(artifactDir, "continuum-delivery.json"), JSON.stringify(deliveryReceipt, null, 2) + "\n");
    await writeFile(join(artifactDir, "provider-usage.json"), JSON.stringify({ schemaVersion: "continuum.provider-usage.v1", measured: telemetry.usage !== null, usage: telemetry.usage, reportedCost: telemetry.reportedCost ?? null, source: isOpenCode ? "opencode-json-events" : "antigravity-stream-json-result" }, null, 2) + "\n");
    await writeFile(join(artifactDir, "provider-cost.json"), JSON.stringify({ schemaVersion: "continuum.provider-cost.v1", measurement: providerCost ? "derived" : "unavailable", pricingProfile: manifest.controls.pricingProfile, cost: providerCost }, null, 2) + "\n");
    let continuumSession = null;
    if (treatment !== "continuum_off") {
      const listed = await continuum(repository, "session", "list", "--json");
      let sessions = [];
      try { sessions = listed.exitCode === 0 ? JSON.parse(listed.stdout).sessions ?? [] : []; } catch { sessions = []; }
      const match = sessions.find((item) => item.session.task.originalTask === task.task);
      if (match) {
        const report = await continuum(repository, "session", "report", match.session.id, "--json");
        try { continuumSession = report.exitCode === 0 ? JSON.parse(report.stdout) : { error: report.stderr }; }
        catch { continuumSession = { error: "Continuum session report was not valid JSON", stderr: report.stderr }; }
      }
    }
    const validation = await verifyPhase6Task({ repository, task: { ...task, id: taskId }, status: after.stdout });
    const hiddenValidation = await verifyPhase6HiddenTask({ repository, taskId });
    const outcome = deriveRunOutcome({ agent: { ...agent, status: telemetry.status }, failureCategory, git: { diffCheckExitCode: diffCheck.exitCode, changed: relevantPaths.length > 0 }, validation, hiddenValidation });
    await writeFile(join(artifactDir, "validation.json"), JSON.stringify(validation, null, 2) + "\n");
    await writeFile(join(artifactDir, "hidden-validation.json"), JSON.stringify(hiddenValidation, null, 2) + "\n");
    const restoration = await mcpGuard.restore();
    const result = {
      schemaVersion: "continuum.agent-effectiveness-run.v2",
      manifest: { ...manifest, completedAt: new Date().toISOString() },
      agent: { exitCode: agent.exitCode, durationMs: agent.durationMs, stdoutBytes: Buffer.byteLength(agent.stdout), stderrBytes: Buffer.byteLength(agent.stderr), ...telemetry, failureCategory, cost: providerCost },
      outcome,
      git: { baseCommit: beforeHead.stdout.trim(), finalHead: afterHead.stdout.trim(), before: before.stdout, after: after.stdout, diffCheckExitCode: diffCheck.exitCode, changed: relevantPaths.length > 0, changedPaths: relevantPaths, infrastructurePaths, diffStat: diffStat.stdout, changedFiles: diffNames.stdout, untrackedFiles: untracked.stdout },
      validation,
      hiddenValidation,
      evidence: {
        providerUsage: telemetry.usage ? "measured" : "unavailable",
        providerUsageArtifact: "provider-usage.json",
        providerCost: providerCost ? "derived" : "unavailable_pricing_profile",
        providerCostArtifact: "provider-cost.json",
        cliEvents: { artifact: "agent-output.jsonl", eventCount: telemetry.eventCount, toolCallCount: telemetry.toolCallCount },
        git: { statusBefore: "git-status-before.txt", statusAfter: "git-status-after.txt", patch: "git-diff.patch", diffCheckExitCode: diffCheck.exitCode },
        validation: "validation.json",
        hiddenValidation: "hidden-validation.json",
        continuumInitialization: treatment !== "continuum_off" ? "continuum-initialization.json" : "not_applicable",
        context: isPreflight ? "continuum-preflight.json + continuum_session_report" : treatment === "continuum_on" ? "continuum_session_report" : "not_applicable",
        delivery: "continuum-delivery.json",
        outcome: "embedded in result.json",
      },
      mcp: { setup: mcpGuard.setup, restoration },
      continuumSession,
      delivery: deliveryReceipt,
    };
    await writeFile(join(artifactDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ result, artifactDir, repository }, null, 2));
  } finally {
    if (mcpGuard) await mcpGuard.restore().catch(async (error) => {
      await writeFile(join(artifactDir, "continuum-restore-error.json"), JSON.stringify({ error: String(error) }, null, 2) + "\n");
    });
    if (!keep) await rm(scratch, { recursive: true, force: true });
  }
};

for (let repetition = 1; repetition <= repetitions; repetition += 1) await runOne(repetition);
