#!/usr/bin/env node
import { buildEffectivenessReport } from "./phase6-report-model.mjs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const report = buildEffectivenessReport(entries, source);
await writeFile(outputBase + ".json", JSON.stringify(report, null, 2) + "\n");
const markdown = ["# Phase 6 Effectiveness Report", "", `Runs: ${report.records}; unpaired runs: ${report.unpairedRuns}`, "", "| Comparison | Agent/model | Eligible pairs | Control success | Treatment success | Token median delta | Cost median delta |", "|---|---|---:|---:|---:|---:|---:|", ...report.comparisons.flatMap(comparison => comparison.byModel.map(item => `| ${comparison.control} → ${comparison.treatment} | ${item.agent}/${item.model} | ${item.pairs} | ${item.control.verifiedSuccessRate ?? "n/a"} | ${item.treatment.verifiedSuccessRate ?? "n/a"} | ${item.delta.totalTokens.medianOnMinusOff ?? "n/a"} | ${item.delta.cost.medianOnMinusOff ?? "n/a"} |`)), "", "Provider failures and legacy heuristic validation are excluded from effectiveness claims. Costs require complete pricing evidence. Decision-ready: no; repeated independently verified qualification is still required."];
await writeFile(outputBase + ".md", markdown.join("\n") + "\n");
console.log(JSON.stringify({ records: report.records, pairedRuns: report.pairedRuns, preflightOnlyPairedRuns: report.preflightOnlyPairedRuns, outputBase }));
