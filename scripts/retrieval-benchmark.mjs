#!/usr/bin/env node
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ContextEngine, RepositoryContextSessionService } from "../packages/context-engine/dist/index.js";
import { migrate, openDatabase, RepositoryRepository } from "../packages/database/dist/index.js";
import { resolveSnapshotIdentity } from "../packages/git-analyzer/dist/index.js";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(root, "packages", "context-engine", "benchmarks", "v1");
const cli = join(root, "apps", "cli", "dist", "main.js");
const dataset = JSON.parse(await readFile(join(fixtureRoot, "cases.json"), "utf8"));
const scratch = await mkdtemp(join(tmpdir(), "continuum-retrieval-benchmark-"));

const round = (value, digits = 4) => Number(value.toFixed(digits));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values, value) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] ?? 0; };
const slash = (value) => value.replaceAll("\\", "/");
const symbolMatches = (actual, expected) => {
  if (!actual) return false;
  const left = actual.toLowerCase();
  const right = expected.toLowerCase();
  return left === right || left.endsWith("." + right) || right.endsWith("." + left);
};
const relevant = (candidate, benchmarkCase) =>
  benchmarkCase.requiredPaths.some((path) => slash(candidate.item.source_path).toLowerCase() === slash(path).toLowerCase()) ||
  benchmarkCase.requiredSymbols.some((symbol) => symbolMatches(candidate.item.symbol_name, symbol)) ||
  (benchmarkCase.optionalRelevantItemIds ?? []).some((id) => {
    const [path, symbol] = id.split("#");
    return (!path || path === "*" || slash(candidate.item.source_path).toLowerCase() === slash(path).toLowerCase()) &&
      (!symbol || symbol === "*" || symbolMatches(candidate.item.symbol_name, symbol));
  });
const explicitlyIrrelevant = (candidate, benchmarkCase) => (benchmarkCase.explicitlyIrrelevantItemIds ?? []).some((id) => {
  const [path, symbol] = id.split("#");
  return (!path || path === "*" || slash(candidate.item.source_path).toLowerCase() === slash(path).toLowerCase()) &&
    (!symbol || symbol === "*" || symbolMatches(candidate.item.symbol_name, symbol));
});
const requirementRanks = (ranked, benchmarkCase) => [
  ...benchmarkCase.requiredPaths.map((path) => ranked.findIndex((candidate) => slash(candidate.item.source_path).toLowerCase() === slash(path).toLowerCase()) + 1),
  ...benchmarkCase.requiredSymbols.map((symbol) => ranked.findIndex((candidate) => symbolMatches(candidate.item.symbol_name, symbol)) + 1),
];
const recallAt = (ranks, cutoff) => ranks.length ? ranks.filter((rank) => rank > 0 && rank <= cutoff).length / ranks.length : 1;
const precisionAt = (ranked, benchmarkCase, cutoff) => ranked.slice(0, cutoff).filter((candidate) => relevant(candidate, benchmarkCase)).length / cutoff;
const scoreFor = (candidate, mode) => {
  const c = candidate.components;
  const lexical = c.exactSymbol + c.exactTitle + c.exactPath + c.lexical + c.contextualHeader + c.currentSnapshot + c.uncommittedPenalty + c.stalenessPenalty + c.historicalPenalty + c.tokenCostPenalty + c.duplicatePenalty;
  const graph = c.dependencyRelation + c.testRelation + c.architectureRelation + c.configurationRelation + c.priorEpisodeRelation;
  const coverage = c.taskClassRelevance + c.riskCoverage;
  if (mode === "lexical_only") return lexical;
  if (mode === "lexical_graph") return lexical + graph;
  if (mode === "lexical_coverage") return lexical + coverage;
  if (mode === "lexical_graph_coverage") return lexical + graph + coverage;
  return candidate.score;
};
const rerank = (candidates, mode) => [...candidates].sort((a, b) => scoreFor(b, mode) - scoreFor(a, mode) || a.item.id.localeCompare(b.item.id));
const cliRun = async (cwd, args) => exec(process.execPath, [cli, ...args], { cwd, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
const cliJson = async (cwd, args) => JSON.parse((await cliRun(cwd, [...args, "--json"])).stdout.trim());

function metricsFor(ranked, benchmarkCase, packet, latencyMs) {
  const ranks = requirementRanks(ranked, benchmarkCase);
  const first = ranks.filter((rank) => rank > 0).sort((a, b) => a - b)[0] ?? 0;
  const selected = [...packet.orientation.items, ...packet.implementation.items].map((item) => item.candidate);
  const selectedCoverage = new Set(selected.flatMap((candidate) => candidate.coverageCategories));
  return {
    recallAt1: round(recallAt(ranks, 1)), recallAt5: round(recallAt(ranks, 5)), recallAt10: round(recallAt(ranks, 10)),
    precisionAt5: round(precisionAt(ranked, benchmarkCase, 5)), precisionAt10: round(precisionAt(ranked, benchmarkCase, 10)),
    reciprocalRank: round(first ? 1 / first : 0),
    mandatoryCoverageRecall: round(benchmarkCase.requiredCoverage.length ? benchmarkCase.requiredCoverage.filter((category) => selectedCoverage.has(category)).length / benchmarkCase.requiredCoverage.length : 1),
    initialPacketEstimatedTokens: packet.totalEstimatedTokens,
    totalSelectedEstimatedTokens: selected.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0),
    irrelevantSelectedItemCount: selected.filter((candidate) => explicitlyIrrelevant(candidate, benchmarkCase)).length,
    retrievalLatencyMs: round(latencyMs, 3),
  };
}

function aggregate(rows) {
  const values = rows.map((row) => row.metrics ?? row);
  return {
    caseCount: values.length,
    recallAt1: round(mean(values.map((x) => x.recallAt1))), recallAt5: round(mean(values.map((x) => x.recallAt5))), recallAt10: round(mean(values.map((x) => x.recallAt10))),
    precisionAt5: round(mean(values.map((x) => x.precisionAt5))), precisionAt10: round(mean(values.map((x) => x.precisionAt10))),
    meanReciprocalRank: round(mean(values.map((x) => x.reciprocalRank))), mandatoryCoverageRecall: round(mean(values.map((x) => x.mandatoryCoverageRecall))),
    medianInitialPacketEstimatedTokens: round(median(values.map((x) => x.initialPacketEstimatedTokens))),
    p90InitialPacketEstimatedTokens: round(percentile(values.map((x) => x.initialPacketEstimatedTokens), 0.9)),
    maximumInitialPacketEstimatedTokens: Math.max(...values.map((x) => x.initialPacketEstimatedTokens)),
    medianRetrievalLatencyMs: round(median(values.map((x) => x.retrievalLatencyMs)), 3),
    p90RetrievalLatencyMs: round(percentile(values.map((x) => x.retrievalLatencyMs), 0.9), 3),
    maximumRetrievalLatencyMs: round(Math.max(...values.map((x) => x.retrievalLatencyMs)), 3),
    irrelevantSelectedItemCount: values.reduce((sum, x) => sum + x.irrelevantSelectedItemCount, 0),
  };
}

function failureFor(row) {
  if (row.metrics.recallAt10 === 1 && row.metrics.mandatoryCoverageRecall === 1) return null;
  const missing = row.requirementRanks.map((rank, index) => ({ requirement: row.requirements[index], rank, indexed: row.indexedRequirementPresence[index] })).filter((entry) => entry.rank === 0 || entry.rank > 10);
  let classification = "ranking_weight_problem";
  if (missing.some((entry) => !entry.indexed)) classification = "extractor_failure";
  else if (row.metrics.mandatoryCoverageRecall < 1) classification = "incorrect_coverage_classification";
  else if (missing.some((entry) => entry.rank === 0)) classification = "vocabulary_mismatch";
  const explanations = {
    extractor_failure: "Mandatory context was absent from the repository index.",
    incorrect_coverage_classification: "Selected packet did not expose every manually required coverage category.",
    vocabulary_mismatch: "Mandatory context was indexed but the task vocabulary did not seed it into the production candidate pool.",
    ranking_weight_problem: "Mandatory context existed but ranked below the top-ten cutoff.",
  };
  return { caseId: row.id, classification, expected: missing.map((entry) => entry.requirement), retrievedTop10: row.top10, explanation: explanations[classification], defectArea: classification === "extractor_failure" ? "extraction_or_indexing" : "retrieval" };
}

const fixtureState = new Map();
try {
  for (const name of [...new Set(dataset.cases.map((item) => item.repositoryFixture))]) {
    console.error("[benchmark] preparing fixture " + name);
    const repo = join(scratch, name);
    await cp(join(fixtureRoot, "repositories", name), repo, { recursive: true });
    await exec("git", ["init"], { cwd: repo, windowsHide: true });
    await exec("git", ["config", "user.email", "benchmark@continuum.invalid"], { cwd: repo, windowsHide: true });
    await exec("git", ["config", "user.name", "Continuum Benchmark"], { cwd: repo, windowsHide: true });
    await exec("git", ["add", "."], { cwd: repo, windowsHide: true });
    await exec("git", ["commit", "-m", "benchmark fixture"], { cwd: repo, windowsHide: true });
    await cliRun(repo, ["init", "--non-interactive"]);
    await cliRun(repo, ["index"]);
    const db = openDatabase(join(repo, ".continuum", "continuum.db"));
    migrate(db);
    const repository = new RepositoryRepository(db).findByPath(slash(repo));
    if (!repository) throw new Error("Indexed repository row missing for " + repo);
    const snapshot = await resolveSnapshotIdentity(repo);
    fixtureState.set(name, { repo, db, engine: new ContextEngine(db, repository.id, snapshot) });
    console.error("[benchmark] fixture ready " + name);
  }

  const caseRows = [];
  const modes = ["lexical_only", "lexical_graph", "lexical_coverage", "lexical_graph_coverage", "full"];
  const ablationRows = Object.fromEntries(modes.map((mode) => [mode, []]));
  for (const benchmarkCase of dataset.cases) {
    console.error("[benchmark] case " + benchmarkCase.id);
    const state = fixtureState.get(benchmarkCase.repositoryFixture);
    const started = performance.now();
    const candidates = await state.engine.search(benchmarkCase.task, { limit: 100 });
    const latencyMs = performance.now() - started;
    const packet = await state.engine.packet(benchmarkCase.task);
    const ranked = rerank(candidates, "full");
    const requirements = [...benchmarkCase.requiredPaths.map((path) => "path:" + path), ...benchmarkCase.requiredSymbols.map((symbol) => "symbol:" + symbol)];
    const indexed = state.db.prepare("SELECT source_path, symbol_name FROM context_item_versions WHERE valid_to_commit_exclusive IS NULL").all();
    const indexedRequirementPresence = [
      ...benchmarkCase.requiredPaths.map((path) => indexed.some((item) => slash(item.source_path).toLowerCase() === slash(path).toLowerCase())),
      ...benchmarkCase.requiredSymbols.map((symbol) => indexed.some((item) => symbolMatches(item.symbol_name, symbol))),
    ];
    const row = {
      id: benchmarkCase.id, repositoryFixture: benchmarkCase.repositoryFixture, category: benchmarkCase.category, task: benchmarkCase.task,
      requirements, indexedRequirementPresence, requirementRanks: requirementRanks(ranked, benchmarkCase),
      top10: ranked.slice(0, 10).map((candidate, index) => ({ rank: index + 1, path: candidate.item.source_path, symbol: candidate.item.symbol_name, score: round(candidate.score), coverage: candidate.coverageCategories })),
      metrics: metricsFor(ranked, benchmarkCase, packet, latencyMs),
    };
    caseRows.push(row);
    for (const mode of modes) {
      const modeRanked = rerank(candidates, mode);
      ablationRows[mode].push(metricsFor(modeRanked, benchmarkCase, packet, latencyMs));
    }
  }

  let repeatRequests = 0;
  let duplicateFullResends = 0;
  let duplicateTokensAvoided = 0;
  for (const [name, state] of fixtureState) {
    console.error("[benchmark] duplicate session " + name);
    const sample = dataset.cases.find((item) => item.repositoryFixture === name && item.requiredSymbols.length) ?? dataset.cases.find((item) => item.repositoryFixture === name);
    const service = await RepositoryContextSessionService.open(state.repo);
    try {
      const started = await service.start({ task: sample.task, maximumEstimatedTokens: 8000, createInitialContext: false });
      const request = { query: sample.task, requestedSymbols: sample.requiredSymbols, requestedPaths: sample.requiredPaths };
      const first = await service.request(started.session.id, request);
      const repeated = await service.request(started.session.id, request);
      const firstHashes = new Set(first.newItems.map((item) => item.candidate.item.content_hash));
      repeatRequests += 1;
      if (repeated.newItems.some((item) => firstHashes.has(item.candidate.item.content_hash))) duplicateFullResends += 1;
      duplicateTokensAvoided += repeated.estimatedDuplicateTokensAvoided;
      await service.complete(started.session.id, { status: "completed" });
    } finally { service.close(); }
  }

  const categories = [...new Set(dataset.cases.map((item) => item.category))];
  const result = {
    schemaVersion: "continuum.retrieval-benchmark-result.v1",
    datasetSchemaVersion: dataset.schemaVersion,
    generatedAt: new Date().toISOString(),
    environment: { platform: process.platform, architecture: process.arch, node: process.version, cpu: process.env.PROCESSOR_IDENTIFIER ?? "unavailable", logicalProcessors: Number(process.env.NUMBER_OF_PROCESSORS ?? 0), totalMemoryBytes: (await import("node:os")).totalmem() },
    evidence: { retrievalQuality: "measured", latency: "measured locally", tokens: "estimated", providerCost: "unavailable", taskSuccess: "not evaluated in this phase" },
    aggregate: { ...aggregate(caseRows), duplicateFullContentResendRate: round(repeatRequests ? duplicateFullResends / repeatRequests : 0), repeatRequestCount: repeatRequests, estimatedDuplicateTokensAvoided: duplicateTokensAvoided },
    byCategory: Object.fromEntries(categories.map((category) => [category, aggregate(caseRows.filter((row) => row.category === category))])),
    ablations: Object.fromEntries(modes.map((mode) => [mode, aggregate(ablationRows[mode])])),
    cases: caseRows,
    failures: caseRows.map(failureFor).filter(Boolean),
  };
  await writeFile(join(fixtureRoot, "results.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ schemaVersion: result.schemaVersion, aggregate: result.aggregate, ablations: result.ablations, failureCount: result.failures.length, resultsFile: slash(join(fixtureRoot, "results.json")) }, null, 2));
} finally {
  for (const state of fixtureState.values()) state.db.close();
  if (process.env.CONTINUUM_BENCHMARK_KEEP_TEMP === "1") console.error("[benchmark] retained temp " + scratch);
  else await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
