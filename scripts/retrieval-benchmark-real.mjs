#!/usr/bin/env node
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ContextEngine } from "../packages/context-engine/dist/index.js";
import { migrate, openDatabase, RepositoryRepository } from "../packages/database/dist/index.js";
import { resolveSnapshotIdentity } from "../packages/git-analyzer/dist/index.js";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(root, "packages", "context-engine", "benchmarks", "v1");
const cli = join(root, "apps", "cli", "dist", "main.js");
const dataset = JSON.parse(await readFile(join(fixtureRoot, "real-cases.json"), "utf8"));
const scratch = await mkdtemp(join(tmpdir(), "continuum-real-benchmark-"));
const slash = (value) => value.replaceAll("\\", "/");
const round = (value, digits = 4) => Number(value.toFixed(digits));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); const m = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2; };
const percentile = (values, value) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] ?? 0; };
const symbolMatches = (actual, expected) => actual && (actual.toLowerCase() === expected.toLowerCase() || actual.toLowerCase().endsWith("." + expected.toLowerCase()) || expected.toLowerCase().endsWith("." + actual.toLowerCase()));
const requirementRanks = (ranked, item) => [
  ...item.requiredPaths.map((path) => ranked.findIndex((candidate) => slash(candidate.item.source_path).toLowerCase() === slash(path).toLowerCase()) + 1),
  ...item.requiredSymbols.map((symbol) => ranked.findIndex((candidate) => symbolMatches(candidate.item.symbol_name, symbol)) + 1),
];
const recall = (ranks, cutoff) => ranks.filter((rank) => rank > 0 && rank <= cutoff).length / ranks.length;
const excluded = new Set([".git", ".continuum", "node_modules", "dist", "coverage", ".next", ".turbo"]);
const keep = (source) => !slash(source).split("/").some((part) => excluded.has(part));
const cliRun = async (cwd, args) => exec(process.execPath, [cli, ...args], { cwd, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
const isMandatory = (candidate, item) =>
  item.requiredPaths.some((path) => slash(candidate.item.source_path).toLowerCase() === slash(path).toLowerCase()) ||
  item.requiredSymbols.some((symbol) => symbolMatches(candidate.item.symbol_name, symbol));
const componentSum = (candidate, keys) => round(keys.reduce((sum, key) => sum + candidate.components[key], 0));
const compositionFor = (packet, item) => {
  const selected = [...packet.orientation.items, ...packet.implementation.items].map((entry) => ({ entry, delivery: "full_content" }));
  const metadata = packet.escalationCandidates.items.map((entry) => ({ entry, delivery: "metadata_only" }));
  const describe = ({ entry, delivery }) => {
    const candidate = entry.candidate;
    return {
      itemId: candidate.item.id, sourcePath: candidate.item.source_path, symbol: candidate.item.symbol_name,
      coverageCategories: candidate.coverageCategories, selectionReasons: candidate.reasons,
      exactMatchScore: componentSum(candidate, ["exactSymbol", "exactTitle", "exactPath"]),
      lexicalScore: componentSum(candidate, ["lexical", "contextualHeader"]),
      relationshipScore: componentSum(candidate, ["dependencyRelation", "testRelation", "architectureRelation", "configurationRelation", "priorEpisodeRelation"]),
      coverageScore: componentSum(candidate, ["taskClassRelevance", "riskCoverage"]),
      estimatedTokens: candidate.estimatedTokens, relevance: isMandatory(candidate, item) ? "mandatory" : "optional",
      delivery, representation: candidate.item.symbol_name ? "symbol_level" : "full_file",
    };
  };
  const full = selected.map(describe);
  const totalFor = (predicate) => full.filter(predicate).reduce((sum, value) => sum + value.estimatedTokens, 0);
  const coverageTotal = (category) => totalFor((value) => value.coverageCategories.includes(category));
  return {
    items: [...full, ...metadata.map(describe)],
    totals: {
      mandatoryTokens: totalFor((value) => value.relevance === "mandatory"), optionalTokens: totalFor((value) => value.relevance === "optional"),
      implementationTokens: coverageTotal("implementation"), testTokens: coverageTotal("tests"), documentationTokens: coverageTotal("documentation"),
      configurationTokens: coverageTotal("configuration"), constraintTokens: totalFor((value) => value.coverageCategories.some((category) => ["security_constraint", "database_schema", "rollback"].includes(category))),
      fullFileTokens: totalFor((value) => value.representation === "full_file"), symbolLevelTokens: totalFor((value) => value.representation === "symbol_level"),
      metadataOnlyCandidateCount: metadata.length,
    },
    largestFiveSelectedItems: [...full].sort((left, right) => right.estimatedTokens - left.estimatedTokens).slice(0, 5),
  };
};

const repositoryResults = [];
try {
  for (const repositoryCase of dataset.repositories) {
    console.error("[real benchmark] preparing " + repositoryCase.id);
    const repo = join(scratch, repositoryCase.id);
    await cp(repositoryCase.sourcePath, repo, { recursive: true, filter: keep });
    await exec("git", ["init"], { cwd: repo, windowsHide: true });
    await exec("git", ["config", "user.email", "benchmark@continuum.invalid"], { cwd: repo, windowsHide: true });
    await exec("git", ["config", "user.name", "Continuum Benchmark"], { cwd: repo, windowsHide: true });
    await exec("git", ["add", "."], { cwd: repo, windowsHide: true });
    await exec("git", ["commit", "-m", "real repository benchmark snapshot"], { cwd: repo, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
    await cliRun(repo, ["init", "--non-interactive"]);
    const indexStarted = performance.now();
    await cliRun(repo, ["index"]);
    const indexDurationMs = performance.now() - indexStarted;
    const db = openDatabase(join(repo, ".continuum", "continuum.db"));
    migrate(db);
    try {
      const repository = new RepositoryRepository(db).findByPath(slash(repo));
      if (!repository) throw new Error("Indexed repository row missing: " + repo);
      const engine = new ContextEngine(db, repository.id, await resolveSnapshotIdentity(repo));
      const rows = [];
      for (const item of repositoryCase.cases) {
        const started = performance.now();
        const candidates = await engine.search(item.task, { limit: 100 });
        const latencyMs = performance.now() - started;
        const stageProfile = {};
        const packet = await engine.packet(item.task, undefined, stageProfile);
        const ranks = requirementRanks(candidates, item);
        rows.push({ id: item.id, task: item.task, requiredPaths: item.requiredPaths, requiredSymbols: item.requiredSymbols, requirementRanks: ranks,
          metrics: { recallAt1: round(recall(ranks, 1)), recallAt5: round(recall(ranks, 5)), recallAt10: round(recall(ranks, 10)), reciprocalRank: round(Math.min(...ranks.filter((rank) => rank > 0), Infinity) === Infinity ? 0 : 1 / Math.min(...ranks.filter((rank) => rank > 0))), initialPacketEstimatedTokens: packet.totalEstimatedTokens, retrievalLatencyMs: round(latencyMs, 3), stageProfile: Object.fromEntries(Object.entries(stageProfile).map(([key, value]) => [key, round(value, 3)])) },
          packetComposition: compositionFor(packet, item),
          top10: candidates.slice(0, 10).map((candidate, index) => ({ rank: index + 1, path: candidate.item.source_path, symbol: candidate.item.symbol_name, score: round(candidate.score) })) });
      }
      const stageNames = ["taskAnalysis", "queryNormalization", "exactLookup", "lexicalFtsLookup", "candidateSeeding", "relationshipExpansion", "coverageClassification", "databaseHydration", "ranking", "diversitySelection", "tokenEstimation", "packetAssembly"];
      const stageLatency = Object.fromEntries(stageNames.map((name) => { const values = rows.map((row) => row.metrics.stageProfile[name] ?? 0); return [name, { p50Ms: round(median(values), 3), p90Ms: round(percentile(values, 0.9), 3), maximumMs: round(Math.max(...values), 3) }]; }));
      repositoryResults.push({ id: repositoryCase.id, description: repositoryCase.description, sourceSnapshot: repositoryCase.sourcePath, evaluationMode: "isolated source copy indexed through built CLI", indexDurationMs: round(indexDurationMs, 3), caseCount: rows.length,
        aggregate: { recallAt1: round(mean(rows.map((row) => row.metrics.recallAt1))), recallAt5: round(mean(rows.map((row) => row.metrics.recallAt5))), recallAt10: round(mean(rows.map((row) => row.metrics.recallAt10))), meanReciprocalRank: round(mean(rows.map((row) => row.metrics.reciprocalRank))), medianInitialPacketEstimatedTokens: round(median(rows.map((row) => row.metrics.initialPacketEstimatedTokens))), p90InitialPacketEstimatedTokens: round(percentile(rows.map((row) => row.metrics.initialPacketEstimatedTokens), 0.9)), maximumInitialPacketEstimatedTokens: Math.max(...rows.map((row) => row.metrics.initialPacketEstimatedTokens)), medianRetrievalLatencyMs: round(median(rows.map((row) => row.metrics.retrievalLatencyMs)), 3), p90RetrievalLatencyMs: round(percentile(rows.map((row) => row.metrics.retrievalLatencyMs), 0.9), 3), maximumRetrievalLatencyMs: round(Math.max(...rows.map((row) => row.metrics.retrievalLatencyMs)), 3), stageLatency }, cases: rows });
    } finally { db.close(); }
  }
  const result = { schemaVersion: "continuum.real-repository-benchmark-result.v1", datasetSchemaVersion: dataset.schemaVersion, generatedAt: new Date().toISOString(), environment: { platform: process.platform, architecture: process.arch, node: process.version, cpu: process.env.PROCESSOR_IDENTIFIER ?? "unavailable", logicalProcessors: Number(process.env.NUMBER_OF_PROCESSORS ?? 0), totalMemoryBytes: totalmem() }, evidence: { retrievalQuality: "measured", latency: "measured locally", tokens: "estimated", providerCost: "unavailable", taskSuccess: "not evaluated in this phase" }, repositories: repositoryResults };
  await writeFile(join(fixtureRoot, "real-results.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(repositoryResults.map(({ id, caseCount, indexDurationMs, aggregate }) => ({ id, caseCount, indexDurationMs, aggregate })), null, 2));
} finally {
  if (process.env.CONTINUUM_BENCHMARK_KEEP_TEMP === "1") console.error("[real benchmark] retained temp " + scratch);
  else await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
