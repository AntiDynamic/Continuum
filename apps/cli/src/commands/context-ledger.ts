import { ContextLedgerRepository, RunRepository, type Db } from "@continuum/database";
import { CharacterRatioTokenEstimator, buildContextPacketAccounting } from "@continuum/shared";
import type { CompiledContextPacket, ContextDeliveryStage, ContextPacketAccountingInput } from "@continuum/shared";
import { line } from "../display.js";

function category(path: string): "code" | "documentation" | "tests" {
  if (/(^|[\\/])(test|tests|__tests__)([\\/]|$)|\.(test|spec)\./i.test(path)) return "tests";
  return /\.md$/i.test(path) ? "documentation" : "code";
}

export function recordContextPacketLedger(db: Db, packet: CompiledContextPacket, options: { runId?: string; stage?: ContextDeliveryStage; verbose: boolean }): void {
  if (!options.runId) return;
  const runId = options.runId === "latest" ? new RunRepository(db).findLatest()?.id : options.runId;
  if (!runId) return;
  const estimator = new CharacterRatioTokenEstimator();
  const input: ContextPacketAccountingInput = { metadata: [], code: [], documentation: [], tests: [], duplicateContent: [], historicalExcluded: [], staleExcluded: [] };
  const ledger = new ContextLedgerRepository(db);
  const packetId = crypto.randomUUID();
  ledger.recordPacket({ id: packetId, runId, accounting: buildContextPacketAccounting(input, estimator) });
  for (const selected of [...packet.orientation.items, ...packet.implementation.items]) {
    const version = selected.candidate.item;
    const content = version.compiled_content ?? version.content;
    const decision = ledger.recordDelivery({ runId, packetId, contextItemVersionId: version.id, stage: options.stage ?? "implementation", estimatedTokens: selected.candidate.estimatedTokens });
    if (!decision.suppliedToAgent) {
      input.duplicateContent?.push(content);
      if (options.verbose) line(`Reference existing delivery ${decision.duplicateOfDeliveryId ?? "unknown"} (${decision.reason}); content not repeated.`);
      continue;
    }
    input.metadata.push(`${version.source_path}:${version.symbol_name ?? "file"}`);
    input[category(version.source_path)].push(content);
  }
  const accounting = buildContextPacketAccounting(input, estimator);
  ledger.updatePacketAccounting(packetId, accounting);
  if (options.verbose) {
    line(`New tokens delivered: ${accounting.newTokensDelivered}`);
    line(`Potential duplicate tokens avoided: ${accounting.potentialDuplicateTokensAvoided}`);
  }
}
