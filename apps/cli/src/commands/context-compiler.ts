import { basename, resolve } from "node:path";
import { ContextEngine } from "@continuum/context-engine";
import { RepositoryRepository, migrate, openDatabase } from "@continuum/database";
import { getRepositoryRoot, isGitRepository, resolveSnapshotIdentity } from "@continuum/git-analyzer";
import type { ContextCandidate, ContextDeliveryStage } from "@continuum/shared";
import { getDbPath, isInitialised } from "../config-helpers.js";
import { recordContextPacketLedger } from "./context-ledger.js";
import { info, line, printError, section } from "../display.js";

export interface ContextCommandOptions {
  cwd: string;
  repo?: string;
  mode: "search" | "pack" | "explain" | "coverage";
  json?: boolean;
  runId?: string;
  stage?: ContextDeliveryStage;
}

function printCandidate(candidate: ContextCandidate, rank: number): void {
  const item = candidate.item;
  line(`${rank}. ${item.id}  ${item.title ?? item.symbol_name ?? "context item"}`);
  line(`   ${item.source_path}:${item.source_start_line}-${item.source_end_line} | ${candidate.estimatedTokens} tokens | ${item.staleness_status} | score ${candidate.score.toFixed(3)}`);
  line(`   coverage: ${candidate.coverageCategories.join(", ") || "none"}`);
  line(`   components: ${JSON.stringify(candidate.components)}`);
  line(`   reasons: ${candidate.reasons.join(" ")}`);
}

export async function runContextCommand(query: string, options: ContextCommandOptions): Promise<void> {
  const targetDir = options.repo ? resolve(options.cwd, options.repo) : options.cwd;
  if (!(await isGitRepository(targetDir))) {
    printError("Not a Git repository.");
    process.exitCode = 1;
    return;
  }
  const repoRoot = await getRepositoryRoot(targetDir);
  if (!(await isInitialised(repoRoot))) {
    printError("Continuum is not initialised here. Run 'continuum init' first.");
    process.exitCode = 1;
    return;
  }

  const db = openDatabase(getDbPath(repoRoot));
  migrate(db);
  try {
    const repository = new RepositoryRepository(db).upsert(repoRoot, basename(repoRoot));
    const engine = new ContextEngine(db, repository.id, await resolveSnapshotIdentity(repoRoot));
    if (options.mode === "explain") {
      const item = engine.explain(query);
      if (options.json) line(JSON.stringify(item ?? null, null, 2));
      else if (!item) info(`No repository-scoped context item found for ${query}.`);
      else {
        section(item.title ?? item.symbol_name ?? item.id);
        line(`${item.source_path}:${item.source_start_line}-${item.source_end_line}`);
        line(item.compiled_content ?? item.content);
      }
      return;
    }

    const candidates = await engine.search(query);
    if (options.mode === "search") {
      if (options.json) line(JSON.stringify(candidates, null, 2));
      else {
        section(`Context search: ${query}`);
        candidates.slice(0, 20).forEach(printCandidate);
        if (!candidates.length) info("No current, repository-scoped context matched.");
      }
      return;
    }

    if (options.mode === "coverage") {
      const task = engine.analyze(query);
      const coverage = engine.coverageFor(task, candidates);
      const result = { task, coverage };
      if (options.json) line(JSON.stringify(result, null, 2));
      else {
        section(`Coverage: ${task.taskClass} (${task.riskLevel} risk)`);
        line(`Classification: ${task.classificationReasons.join(" ")}`);
        line(`Covered: ${coverage.covered.join(", ") || "none"}`);
        line(`Missing required: ${coverage.missing.join(", ") || "none"}`);
        line(`Complete: ${coverage.complete ? "yes" : "no"}`);
      }
      return;
    }

    const packet = await engine.packet(query);
    recordContextPacketLedger(db, packet, { runId: options.runId, stage: options.stage, verbose: !options.json });
    if (options.json) {
      line(JSON.stringify(packet, null, 2));
      return;
    }
    section(`Context packet: ${packet.task.taskClass} (${packet.task.riskLevel} risk)`);
    line(`Total estimated tokens: ${packet.totalEstimatedTokens}`);
    line(`Budget: ${packet.totalEstimatedTokens}/${packet.budget.maxEstimatedTokens} estimated tokens; ${packet.orientation.items.length + packet.implementation.items.length}/${packet.budget.maxItems} items`);
    line(`Classification: ${packet.task.classificationReasons.join(" ")}`);
    line("Orientation:");
    packet.orientation.items.forEach((item, index) => printCandidate(item.candidate, index + 1));
    line("Implementation:");
    packet.implementation.items.forEach((item, index) => printCandidate(item.candidate, index + 1));
    line("Escalation candidates (metadata only):");
    packet.escalationCandidates.items.forEach((item, index) => printCandidate(item.candidate, index + 1));
    line(`Coverage: ${packet.coverage.covered.join(", ") || "none"}`);
    line(`Missing required: ${packet.coverage.missing.join(", ") || "none"}`);
    if (!packet.complete) line(`Packet incomplete. ${packet.incompleteReasons.join(" ")} Additional estimated budget required: ${packet.coverage.additionalEstimatedBudgetRequired ?? 0} tokens.`);
    line(`Omissions: ${packet.omittedItems.length}`);
  } finally {
    db.close();
  }
}
