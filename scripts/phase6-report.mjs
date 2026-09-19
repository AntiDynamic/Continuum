#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const inputArgument = value("--input", null);
if (!inputArgument) throw new Error("Usage: node scripts/phase6-report.mjs --input <pilot-index.json|run-directory>");
const input = resolve(inputArgument);
const outputArgument = value("--output", null);
const outputBase = outputArgument
  ? resolve(outputArgument).replace(/\.(json|md)$/i, "")
  : join((await stat(input)).isDirectory() ? input : dirname(input), "phase6-report");

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const findResults = async (directory) => {
  const found = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (["EACCES", "EPERM", "ENOENT"].includes(error.code)) return found;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await findResults(path));
    else if (entry.name === "result.json") found.push(path);
  }
  return found;
};

let source;
let entries;
if ((await stat(input)).isDirectory()) {
  const indexPath = join(input, "pilot-index.json");
  try { source = await readJson(indexPath); } catch { source = null; }
  entries = source?.completed ?? await Promise.all((await findResults(input)).map(async (path) => ({
    status: "completed",
    artifactDir: dirname(path),
    result: await readJson(path),
  })));
} else {
  source = await readJson(input);
  entries = source.completed ?? (source.schemaVersion === "continuum.agent-effectiveness-run.v2" ? [{ status: "completed", result: source }] : []);
}

const resultEntries = entries.filter((entry) => entry.result?.schemaVersion === "continuum.agent-effectiveness-run.v2");
const hashSeed = (text) => Number.parseInt(createHash("sha256").update(text).digest("hex").slice(0, 8), 16) >>> 0;
const numbers = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const usageValue = (usage, keys) => {
  for (const key of keys) {
    const value = numbers(usage?.[key]);
    if (value !== null) return value;
  }
  return null;
};
const metric = (result) => {
  const usage = result.agent?.usage ?? null;
  const usageMeasured = usage && ["inputTokens", "input_tokens", "outputTokens", "output_tokens", "thinkingTokens", "thinking_tokens", "cacheReadTokens", "cache_read_tokens", "totalTokens", "total_tokens", "total"].some((key) => numbers(usage[key]) > 0);
  const inputTokens = usageMeasured ? usageValue(usage, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]) : null;
  const cachedInputTokens = usageMeasured ? usageValue(usage, ["cacheReadTokens", "cache_read_tokens", "cachedInputTokens", "cached_input_tokens"]) : null;
  const outputTokens = usageMeasured ? usageValue(usage, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]) : null;
  const thinkingTokens = usageMeasured ? usageValue(usage, ["thinkingTokens", "thinking_tokens", "reasoningTokens", "reasoning_tokens"]) : null;
  const providerTotalValue = usageMeasured ? usageValue(usage, ["totalTokens", "total_tokens", "total"]) : null;
  const providerTotal = providerTotalValue && providerTotalValue > 0 ? providerTotalValue : null;
  const totalTokens = usageMeasured ? (providerTotal ?? (inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0))) : null;
  const cost = numbers(result.agent?.cost?.total);
  const verifiedTaskSuccess = result.agent?.exitCode === 0
    && result.agent?.status !== "TIMEOUT"
    && result.git?.diffCheckExitCode === 0
    && result.validation?.status === "passed"
    && result.validation?.scope?.status === "passed"
    && result.hiddenValidation?.status === "passed";
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    thinkingTokens,
    totalTokens,
    tokenSource: !usageMeasured ? "unavailable" : usage?.totalTokens === undefined && usage?.total_tokens === undefined && usage?.total === undefined ? "input_plus_output_fallback" : "provider_total",
    cost,
    durationMs: numbers(result.agent?.durationMs),
    verifiedTaskSuccess,
  };
};

const records = resultEntries.map((entry) => {
  const result = entry.result;
  const manifest = result.manifest;
  return {
    taskId: manifest.taskId,
    model: manifest.model,
    treatment: manifest.treatment,
    repetition: manifest.repetition,
    artifactDir: entry.artifactDir ?? null,
    validationStatus: result.validation?.status ?? "unavailable",
    hiddenValidationStatus: result.hiddenValidation?.status ?? "unavailable",
    agentStatus: result.agent?.status ?? "unknown",
    failureCategory: result.agent?.failureCategory ?? null,
    metric: metric(result),
  };
});

const median = (values) => {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values, percentileValue) => {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
};
const summary = (items) => {
  const successes = items.filter((item) => item.metric.verifiedTaskSuccess).length;
  const tokenValues = items.map((item) => item.metric.totalTokens);
  const costValues = items.map((item) => item.metric.cost);
  const durationValues = items.map((item) => item.metric.durationMs);
  return {
    runs: items.length,
    verifiedSuccesses: successes,
    verifiedSuccessRate: items.length === 0 ? null : successes / items.length,
    totalTokens: { median: median(tokenValues), p90: percentile(tokenValues, 0.9), measured: tokenValues.filter((value) => value !== null).length },
    cost: { median: median(costValues), p90: percentile(costValues, 0.9), measured: costValues.filter((value) => value !== null).length },
    durationMs: { median: median(durationValues), p90: percentile(durationValues, 0.9), measured: durationValues.filter((value) => value !== null).length },
  };
};

const makeRandom = (initial) => {
  let state = initial || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
};
const bootstrapInterval = (values, seed) => {
  const usable = values.filter((value) => value !== null);
  if (usable.length === 0) return { low: null, high: null, samples: 0 };
  if (usable.length === 1) return { low: usable[0], high: usable[0], samples: 1 };
  const random = makeRandom(seed);
  const samples = [];
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    let total = 0;
    for (let index = 0; index < usable.length; index += 1) total += usable[Math.floor(random() * usable.length)];
    samples.push(total / usable.length);
  }
  samples.sort((a, b) => a - b);
  return { low: samples[250], high: samples[9_749], samples: samples.length };
};
const difference = (pairs, field) => {
  const values = pairs.map((pair) => pair.on.metric[field] === null || pair.off.metric[field] === null ? null : pair.on.metric[field] - pair.off.metric[field]);
  const usable = values.filter((value) => value !== null);
  return {
    pairedRuns: pairs.length,
    measuredRuns: usable.length,
    medianOnMinusOff: median(values),
    bootstrap95: bootstrapInterval(values, hashSeed(`${field}:${pairs.length}`)),
  };
};

const grouped = new Map();
for (const record of records) {
  const key = `${record.model}\u0000${record.taskId}\u0000${record.repetition}`;
  if (!grouped.has(key)) grouped.set(key, {});
  grouped.get(key)[record.treatment] = record;
}
const pairs = [...grouped.values()]
  .filter((group) => group.continuum_off && group.continuum_on)
  .map((group) => ({ off: group.continuum_off, on: group.continuum_on }));
const preflightPairs = [...grouped.values()]
  .filter((group) => group.continuum_off && group.continuum_preflight)
  .map((group) => ({ off: group.continuum_off, on: group.continuum_preflight }));
const models = [...new Set(records.map((record) => record.model))];
const pairedByModel = models.map((model) => {
  const modelPairs = pairs.filter((pair) => pair.off.model === model);
  const off = modelPairs.map((pair) => pair.off);
  const on = modelPairs.map((pair) => pair.on);
  const successValues = modelPairs.map((pair) => Number(pair.on.metric.verifiedTaskSuccess) - Number(pair.off.metric.verifiedTaskSuccess));
  return {
    model,
    pairs: modelPairs.length,
    off: summary(off),
    on: summary(on),
    deltaOnMinusOff: {
      verifiedSuccessRate: difference(modelPairs.map((pair) => ({ off: { metric: { verifiedTaskSuccess: Number(pair.off.metric.verifiedTaskSuccess) } }, on: { metric: { verifiedTaskSuccess: Number(pair.on.metric.verifiedTaskSuccess) } } })), "verifiedTaskSuccess"),
      totalTokens: difference(modelPairs, "totalTokens"),
      cost: difference(modelPairs, "cost"),
      durationMs: difference(modelPairs, "durationMs"),
    },
    successDeltaBootstrap95: bootstrapInterval(successValues, hashSeed(`${model}:success`)),
  };
});
const preflightPairedByModel = models.map((model) => {
  const modelPairs = preflightPairs.filter((pair) => pair.off.model === model);
  const off = modelPairs.map((pair) => pair.off);
  const on = modelPairs.map((pair) => pair.on);
  const successValues = modelPairs.map((pair) => Number(pair.on.metric.verifiedTaskSuccess) - Number(pair.off.metric.verifiedTaskSuccess));
  return {
    model,
    pairs: modelPairs.length,
    off: summary(off),
    preflight: summary(on),
    deltaPreflightMinusOff: {
      verifiedSuccessRate: difference(modelPairs.map((pair) => ({ off: { metric: { verifiedTaskSuccess: Number(pair.off.metric.verifiedTaskSuccess) } }, on: { metric: { verifiedTaskSuccess: Number(pair.on.metric.verifiedTaskSuccess) } } })), "verifiedTaskSuccess"),
      totalTokens: difference(modelPairs, "totalTokens"),
      cost: difference(modelPairs, "cost"),
      durationMs: difference(modelPairs, "durationMs"),
    },
    successDeltaBootstrap95: bootstrapInterval(successValues, hashSeed(`${model}:preflight-success`)),
  };
});

const report = {
  schemaVersion: "continuum.phase6-effectiveness-report.v1",
  generatedAt: new Date().toISOString(),
  source: input,
  sourceManifest: source ? {
    schemaVersion: source.schemaVersion,
    seed: source.seed,
    execute: source.execute,
    taskIds: source.taskIds,
    models: source.models,
    treatments: source.treatments,
  } : null,
  records: records.length,
  infrastructureFailures: entries.filter((entry) => entry.status === "infrastructure_failure").length,
  providerFailures: records.filter((record) => record.failureCategory?.startsWith("provider_")).length,
  failureCategories: records.reduce((counts, record) => {
    if (record.failureCategory) counts[record.failureCategory] = (counts[record.failureCategory] ?? 0) + 1;
    return counts;
  }, {}),
  pairedRuns: pairs.length,
  preflightPairedRuns: preflightPairs.length,
  unpairedRuns: records.length - (pairs.length * 2),
  overall: {
    continuum_off: summary(records.filter((record) => record.treatment === "continuum_off")),
    continuum_on: summary(records.filter((record) => record.treatment === "continuum_on")),
    continuum_preflight: summary(records.filter((record) => record.treatment === "continuum_preflight")),
  },
  pairedByModel,
  preflightPairedByModel,
  limitations: [
    "verifiedTaskSuccess requires both the visible scope/semantic verifier and the independent hidden verifier.",
    "Provider quota/auth/rate-limit failures are censored and must be rerun; they are not model failures.",
    "Provider cost is measured only when a manually versioned pricing profile was supplied and usage telemetry was available.",
    "Infrastructure failures are reported separately and must be rerun under the documented policy; they are not silently counted as model failures.",
  ],
  decisionReady: false,
};
const markdown = [
  "# Phase 6 Effectiveness Report",
  "",
  `Generated: ${report.generatedAt}`,
  `Runs: ${report.records}; paired runs: ${report.pairedRuns}; infrastructure failures: ${report.infrastructureFailures}`,
  "",
  "| Model | Paired runs | Off success | On success | Token Δ (on−off) | Cost Δ (on−off) | Duration Δ (on−off) |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...pairedByModel.map((item) => `| ${item.model} | ${item.pairs} | ${item.off.verifiedSuccessRate ?? "n/a"} | ${item.on.verifiedSuccessRate ?? "n/a"} | ${item.deltaOnMinusOff.totalTokens.medianOnMinusOff ?? "n/a"} | ${item.deltaOnMinusOff.cost.medianOnMinusOff ?? "n/a"} | ${item.deltaOnMinusOff.durationMs.medianOnMinusOff ?? "n/a"} |`),
  ...(preflightPairs.length ? ["", "| Model | Preflight pairs | Off success | Preflight success | Token Δ (preflight−off) | Cost Δ (preflight−off) | Duration Δ (preflight−off) |", "|---|---:|---:|---:|---:|---:|---:|", ...preflightPairedByModel.map((item) => `| ${item.model} | ${item.pairs} | ${item.off.verifiedSuccessRate ?? "n/a"} | ${item.preflight.verifiedSuccessRate ?? "n/a"} | ${item.deltaPreflightMinusOff.totalTokens.medianOnMinusOff ?? "n/a"} | ${item.deltaPreflightMinusOff.cost.medianOnMinusOff ?? "n/a"} | ${item.deltaPreflightMinusOff.durationMs.medianOnMinusOff ?? "n/a"} |`)] : []),
  "",
  "Decision-ready: **no**. The current report is an evidence aggregation layer; independently reviewed task coverage, sufficient repeated runs, and valid provider measurements are still required.",
  "",
  "Limitations:",
  ...report.limitations.map((item) => `- ${item}`),
  "",
].join("\n");
await writeFile(`${outputBase}.json`, JSON.stringify(report, null, 2) + "\n");
await writeFile(`${outputBase}.md`, markdown);
console.log(JSON.stringify({ json: `${outputBase}.json`, markdown: `${outputBase}.md`, records: report.records, pairedRuns: report.pairedRuns, decisionReady: report.decisionReady }, null, 2));
