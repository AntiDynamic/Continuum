#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runner = join(root, "scripts/phase6-agent-runner.mjs");
const fixtureRoot = join(root, "packages/context-engine/benchmarks/v1");
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const has = (name) => args.includes(name);

const outputRoot = resolve(value("--output-root", join(root, "artifacts/phase6-pilot")));
const agent = value("--agent", "agy");
const models = value("--models", "gemini-3.8-flash-medium,gemini-3.1-pro-low").split(",").filter(Boolean);
const treatments = value("--treatments", "continuum_off,continuum_on").split(",").filter(Boolean);
const repetitions = Number(value("--repetitions", "3"));
const timeout = value("--timeout", "15m");
const seed = Number(value("--seed", String(Date.now())));
const pricingProfile = value("--pricing-profile", process.env.CONTINUUM_PHASE6_PRICING_FILE ?? null);
const taskArgument = value("--tasks", "representative");
const resumeArgument = value("--resume", null);
const maxProviderFailures = Number(value("--max-provider-failures", "2"));
let execute = has("--execute");
let keep = has("--keep") || execute;
const retryProviderFailures = has("--retry-provider-failures");

if (models.length === 0) throw new Error("--models must contain at least one model");
if (!["agy", "opencode"].includes(agent)) throw new Error("--agent must be agy or opencode");
if (treatments.length === 0 || treatments.some((item) => !["continuum_off", "continuum_on", "continuum_preflight"].includes(item))) throw new Error("--treatments must contain continuum_off, continuum_on, and/or continuum_preflight");
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("--repetitions must be a positive integer");
if (!Number.isInteger(seed) || seed < 0) throw new Error("--seed must be a non-negative integer");
if (!Number.isInteger(maxProviderFailures) || maxProviderFailures < 1) throw new Error("--max-provider-failures must be a positive integer");

const taskSet = JSON.parse(await readFile(join(fixtureRoot, "phase6-tasks.json"), "utf8"));
const cases = JSON.parse(await readFile(join(fixtureRoot, "cases.json"), "utf8"));
const caseById = new Map(cases.cases.map((item) => [item.id, item]));
const taskSpecById = new Map(taskSet.tasks.map((item) => [item.id, item]));
const representativeTaskIds = [
  "small-local-cache-timeout",
  "mono-cross-user-session",
  "sql-migration-refresh",
  "small-security-token",
];
const taskHash = (taskId) => createHash("sha256").update(JSON.stringify({ ...caseById.get(taskId), ...taskSpecById.get(taskId) })).digest("hex");
const cellKey = (cell) => `${cell.taskId}\u0000${cell.model}\u0000${cell.treatment}\u0000${cell.repetition}`;
const taskIds = taskArgument === "all"
  ? taskSet.tasks.map((item) => item.id)
  : taskArgument === "representative"
    ? representativeTaskIds
    : taskArgument.split(",").filter(Boolean);
for (const taskId of taskIds) {
  if (!caseById.has(taskId) || !taskSpecById.has(taskId)) throw new Error(`Unknown Phase 6 task: ${taskId}`);
}

// Deterministic xorshift shuffle. The same seed recreates the exact launch order.
const makeRandom = (initial) => {
  let state = initial || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
};
const shuffle = (items, random) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

const timestamp = new Date().toISOString().replaceAll(/[^0-9]/g, "").slice(0, 14);
let runRoot;
let pilotManifest;
let order;
let completed;
if (resumeArgument) {
  const resumePath = resolve(resumeArgument);
  const indexPath = resumePath.endsWith(".json") ? resumePath : join(resumePath, "pilot-index.json");
  const previous = JSON.parse(await readFile(indexPath, "utf8"));
  runRoot = previous.runRoot ? resolve(previous.runRoot) : dirname(indexPath);
  pilotManifest = previous;
  execute = execute || previous.execute;
  keep = true;
  order = previous.order;
  completed = previous.completed ?? [];
  if (!Array.isArray(order) || !Array.isArray(completed)) throw new Error("Invalid pilot resume index");
  await mkdir(runRoot, { recursive: true });
} else {
  runRoot = join(outputRoot, `${timestamp}-seed-${seed}`);
  await mkdir(runRoot, { recursive: true });
  const cells = [];
  for (const taskId of taskIds) {
    for (const model of models) {
      for (const treatment of treatments) {
        for (let repetition = 1; repetition <= repetitions; repetition += 1) {
          cells.push({ taskId, model, treatment, repetition });
        }
      }
    }
  }
  order = shuffle(cells, makeRandom(seed));
  pilotManifest = {
    schemaVersion: "continuum.phase6-pilot.v1",
    createdAt: new Date().toISOString(),
    execute,
    keepArtifacts: keep,
    seed,
    repetitionsPerTaskModelTreatment: repetitions,
    models,
    agent,
    treatments,
    taskIds,
    taskHashes: Object.fromEntries(taskIds.map((taskId) => [taskId, taskHash(taskId)])),
    timeout,
    pricingProfile,
    maxProviderFailures,
    runRoot,
    plannedCells: order.length,
    order,
  };
  completed = [];
  await writeFile(join(runRoot, "pilot-manifest.json"), JSON.stringify(pilotManifest, null, 2) + "\n");
}

const completedKeys = new Set(completed.filter((entry) => !(retryProviderFailures && entry.status === "provider_failure")).map(cellKey));
let stoppedReason = null;
for (const [index, cell] of order.entries()) {
  if (completedKeys.has(cellKey(cell))) continue;
  completed = completed.filter((entry) => cellKey(entry) !== cellKey(cell));
  const commandArgs = [
    runner,
    "--agent", agent,
    "--task", cell.taskId,
    "--model", cell.model,
    "--treatment", cell.treatment,
    "--repetitions", "1",
    "--timeout", timeout,
    "--artifact-root", runRoot,
  ];
  if (execute) commandArgs.push("--execute");
  if (keep) commandArgs.push("--keep");
  if (pricingProfile) commandArgs.push("--pricing-profile", resolve(pricingProfile));
  const startedAt = new Date().toISOString();
  let entry;
  try {
    const result = await exec(process.execPath, commandArgs, {
      cwd: root,
      windowsHide: true,
      maxBuffer: 100 * 1024 * 1024,
      timeout: 2 * 60 * 60 * 1000,
    });
    const payload = JSON.parse(result.stdout);
    const providerFailure = payload.result?.agent?.failureCategory?.startsWith("provider_") ?? false;
    entry = {
      ...cell,
      order: index + 1,
      startedAt,
      completedAt: new Date().toISOString(),
      status: providerFailure ? "provider_failure" : payload.result ? "completed" : "preview",
      artifactDir: payload.artifactDir ?? null,
      repository: payload.repository ?? null,
      result: payload.result ?? null,
    };
  } catch (error) {
    entry = {
      ...cell,
      order: index + 1,
      startedAt,
      completedAt: new Date().toISOString(),
      status: "infrastructure_failure",
      error: String(error),
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
  completed.push(entry);
  const currentProviderFailures = completed.filter((item) => item.status === "provider_failure").length;
  await writeFile(join(runRoot, "pilot-index.json"), JSON.stringify({ ...pilotManifest, updatedAt: new Date().toISOString(), completed, stoppedReason: currentProviderFailures >= maxProviderFailures ? "provider_failure_threshold" : null }, null, 2) + "\n");
  console.log(`[phase6-pilot] ${index + 1}/${order.length} ${cell.model} ${cell.treatment} ${cell.taskId} r${cell.repetition}: ${entry.status}`);
  if (execute && currentProviderFailures >= maxProviderFailures) {
    stoppedReason = "provider_failure_threshold";
    break;
  }
}

const failures = completed.filter((item) => item.status === "infrastructure_failure").length;
const providerFailures = completed.filter((item) => item.status === "provider_failure").length;
await writeFile(join(runRoot, "pilot-index.json"), JSON.stringify({ ...pilotManifest, updatedAt: new Date().toISOString(), completed, stoppedReason }, null, 2) + "\n");
console.log(JSON.stringify({ runRoot, planned: order.length, completed: completed.length, remaining: order.length - completed.length, infrastructureFailures: failures, providerFailures, stoppedReason, reportCommand: `node scripts/phase6-report.mjs --input ${join(runRoot, "pilot-index.json")}` }, null, 2));
