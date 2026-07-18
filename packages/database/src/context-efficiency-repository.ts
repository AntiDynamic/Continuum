import type { Db } from "./connection.js";
import { now } from "@continuum/shared";
import type {
  AgentUsageEvidence,
  ContextDeliveryDecision,
  ContextDeliveryStage,
  ContextPacketTokenAccounting,
  ContextPresenceState,
  ModelPricingProfile,
  RunContextLedgerEntry,
  RunCostEvidence,
  StoredModelPricingProfile,
} from "@continuum/shared";

interface PricingProfileRow {
  id: string;
  provider: string;
  model: string;
  version: string | null;
  input_credits_per_million_tokens: number | null;
  cached_input_credits_per_million_tokens: number | null;
  output_credits_per_million_tokens: number | null;
  source: ModelPricingProfile["source"];
  effective_from: string;
  created_at: string;
}

function optionalNumber(value: number | null): number | undefined {
  return value === null ? undefined : value;
}

function validateRate(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${name} must be a finite non-negative number.`);
  }
}

export class PricingProfileRepository {
  constructor(private readonly db: Db) {}

  set(profile: ModelPricingProfile): StoredModelPricingProfile {
    validateRate(
      "inputCreditsPerMillionTokens",
      profile.inputCreditsPerMillionTokens,
    );
    validateRate(
      "cachedInputCreditsPerMillionTokens",
      profile.cachedInputCreditsPerMillionTokens,
    );
    validateRate(
      "outputCreditsPerMillionTokens",
      profile.outputCreditsPerMillionTokens,
    );

    const stored: StoredModelPricingProfile = {
      ...profile,
      id: crypto.randomUUID(),
      effectiveFrom: profile.effectiveFrom ?? now(),
      createdAt: now(),
    };

    this.db.prepare(
      `INSERT INTO pricing_profiles (
        id, provider, model, version,
        input_credits_per_million_tokens,
        cached_input_credits_per_million_tokens,
        output_credits_per_million_tokens,
        source, effective_from, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      stored.id,
      stored.provider,
      stored.model,
      stored.version ?? null,
      stored.inputCreditsPerMillionTokens ?? null,
      stored.cachedInputCreditsPerMillionTokens ?? null,
      stored.outputCreditsPerMillionTokens ?? null,
      stored.source,
      stored.effectiveFrom,
      stored.createdAt,
    );

    return stored;
  }

  findLatest(
    model: string,
    provider?: string,
  ): StoredModelPricingProfile | undefined {
    const row = provider
      ? this.db.prepare(
          `SELECT * FROM pricing_profiles
           WHERE provider = ? AND model = ?
           ORDER BY effective_from DESC, created_at DESC LIMIT 1`,
        ).get(provider, model)
      : this.db.prepare(
          `SELECT * FROM pricing_profiles
           WHERE model = ?
           ORDER BY effective_from DESC, created_at DESC LIMIT 1`,
        ).get(model);

    return row ? this.mapRow(row as unknown as PricingProfileRow) : undefined;
  }

  list(): StoredModelPricingProfile[] {
    return (
      this.db.prepare(
        `SELECT * FROM pricing_profiles
         ORDER BY provider, model, effective_from DESC, created_at DESC`,
      ).all() as unknown as PricingProfileRow[]
    ).map((row) => this.mapRow(row));
  }

  private mapRow(row: PricingProfileRow): StoredModelPricingProfile {
    return {
      id: row.id,
      provider: row.provider,
      model: row.model,
      version: row.version ?? undefined,
      inputCreditsPerMillionTokens: optionalNumber(
        row.input_credits_per_million_tokens,
      ),
      cachedInputCreditsPerMillionTokens: optionalNumber(
        row.cached_input_credits_per_million_tokens,
      ),
      outputCreditsPerMillionTokens: optionalNumber(
        row.output_credits_per_million_tokens,
      ),
      source: row.source,
      effectiveFrom: row.effective_from,
      createdAt: row.created_at,
    };
  }
}

export interface StoredUsageEvidence {
  runId: string;
  provider?: string;
  model?: string;
  usage: AgentUsageEvidence;
  recordedAt: string;
}

interface UsageEvidenceRow {
  run_id: string;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  tool_calls: number | null;
  measurement: AgentUsageEvidence["measurement"];
  recorded_at: string;
}

export class UsageEvidenceRepository {
  constructor(private readonly db: Db) {}

  upsert(params: {
    runId: string;
    provider?: string;
    model?: string;
    usage: AgentUsageEvidence;
  }): void {
    this.db.prepare(
      `INSERT INTO agent_usage_evidence (
        run_id, provider, model, input_tokens, cached_input_tokens,
        output_tokens, reasoning_tokens, tool_calls, measurement, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        provider = excluded.provider,
        model = excluded.model,
        input_tokens = excluded.input_tokens,
        cached_input_tokens = excluded.cached_input_tokens,
        output_tokens = excluded.output_tokens,
        reasoning_tokens = excluded.reasoning_tokens,
        tool_calls = excluded.tool_calls,
        measurement = excluded.measurement,
        recorded_at = excluded.recorded_at`,
    ).run(
      params.runId,
      params.provider ?? null,
      params.model ?? null,
      params.usage.inputTokens ?? null,
      params.usage.cachedInputTokens ?? null,
      params.usage.outputTokens ?? null,
      params.usage.reasoningTokens ?? null,
      params.usage.toolCalls ?? null,
      params.usage.measurement,
      now(),
    );
  }

  findByRunId(runId: string): StoredUsageEvidence | undefined {
    const row = this.db.prepare(
      "SELECT * FROM agent_usage_evidence WHERE run_id = ?",
    ).get(runId) as UsageEvidenceRow | undefined;
    if (!row) return undefined;

    return {
      runId: row.run_id,
      provider: row.provider ?? undefined,
      model: row.model ?? undefined,
      usage: {
        inputTokens: optionalNumber(row.input_tokens),
        cachedInputTokens: optionalNumber(row.cached_input_tokens),
        outputTokens: optionalNumber(row.output_tokens),
        reasoningTokens: optionalNumber(row.reasoning_tokens),
        toolCalls: optionalNumber(row.tool_calls),
        measurement: row.measurement,
      },
      recordedAt: row.recorded_at,
    };
  }
}

interface CostEvidenceRow {
  run_id: string;
  pricing_profile_id: string | null;
  input_credits: number | null;
  cached_input_credits: number | null;
  output_credits: number | null;
  total_credits: number | null;
  measurement: RunCostEvidence["measurement"];
}

export class CostEvidenceRepository {
  constructor(private readonly db: Db) {}

  upsert(evidence: RunCostEvidence, pricingProfileId?: string): void {
    this.db.prepare(
      `INSERT INTO run_cost_evidence (
        run_id, pricing_profile_id, input_credits, cached_input_credits,
        output_credits, total_credits, measurement, calculated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        pricing_profile_id = excluded.pricing_profile_id,
        input_credits = excluded.input_credits,
        cached_input_credits = excluded.cached_input_credits,
        output_credits = excluded.output_credits,
        total_credits = excluded.total_credits,
        measurement = excluded.measurement,
        calculated_at = excluded.calculated_at`,
    ).run(
      evidence.runId,
      pricingProfileId ?? null,
      evidence.inputCredits ?? null,
      evidence.cachedInputCredits ?? null,
      evidence.outputCredits ?? null,
      evidence.totalCredits ?? null,
      evidence.measurement,
      now(),
    );
  }

  findByRunId(runId: string, usage: AgentUsageEvidence): RunCostEvidence | undefined {
    const row = this.db.prepare(
      "SELECT * FROM run_cost_evidence WHERE run_id = ?",
    ).get(runId) as CostEvidenceRow | undefined;
    if (!row) return undefined;

    return {
      runId: row.run_id,
      usage,
      inputCredits: optionalNumber(row.input_credits),
      cachedInputCredits: optionalNumber(row.cached_input_credits),
      outputCredits: optionalNumber(row.output_credits),
      totalCredits: optionalNumber(row.total_credits),
      measurement: row.measurement,
    };
  }
}

interface DeliveryContextRow {
  run_repository_id: number;
  item_repository_id: number;
  kind: string;
  source_path: string;
  content_hash: string;
}

interface DeliveryRow {
  id: string;
  run_id: string;
  packet_id: string;
  context_item_version_id: string;
  delivery_stage: ContextDeliveryStage;
  estimated_tokens: number;
  delivered_at: string;
  was_duplicate: number;
  duplicate_of_delivery_id: string | null;
  supplied_to_agent: number;
  presence_state: ContextPresenceState;
  content_hash: string;
  superseded_by_checkpoint_id: string | null;
}

export class ContextLedgerRepository {
  constructor(private readonly db: Db) {}

  recordPacket(params: {
    id: string;
    runId: string;
    accounting: ContextPacketTokenAccounting;
  }): void {
    this.db.prepare(
      `INSERT INTO context_packets (
        id, run_id, estimator_id, accounting_json, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      params.id,
      params.runId,
      params.accounting.estimatorId,
      JSON.stringify(params.accounting),
      now(),
    );
  }

  updatePacketAccounting(
    packetId: string,
    accounting: ContextPacketTokenAccounting,
  ): void {
    this.db.prepare(
      "UPDATE context_packets SET estimator_id = ?, accounting_json = ? WHERE id = ?",
    ).run(accounting.estimatorId, JSON.stringify(accounting), packetId);
  }

  recordDelivery(params: {
    runId: string;
    packetId: string;
    contextItemVersionId: string;
    stage: ContextDeliveryStage;
    estimatedTokens: number;
  }): ContextDeliveryDecision {
    const context = this.db.prepare(
      `SELECT
        r.repository_id AS run_repository_id,
        ci.repository_id AS item_repository_id,
        ci.kind,
        v.source_path,
        v.content_hash
       FROM agent_runs r
       JOIN context_item_versions v ON v.id = ?
       JOIN context_items ci ON ci.id = v.context_item_id
       WHERE r.id = ?`,
    ).get(
      params.contextItemVersionId,
      params.runId,
    ) as DeliveryContextRow | undefined;

    if (!context) {
      throw new Error("Run or context item version was not found.");
    }
    if (context.run_repository_id !== context.item_repository_id) {
      throw new Error(
        "Context delivery rejected: run and context item belong to different repositories.",
      );
    }

    const packet = this.db.prepare(
      "SELECT run_id FROM context_packets WHERE id = ?",
    ).get(params.packetId) as { run_id: string } | undefined;
    if (!packet || packet.run_id !== params.runId) {
      throw new Error("Context delivery rejected: packet does not belong to the run.");
    }

    let duplicate = this.db.prepare(
      `SELECT id FROM context_deliveries
       WHERE run_id = ? AND content_hash = ? AND presence_state = 'active'
         AND supplied_to_agent = 1
       ORDER BY delivered_at DESC LIMIT 1`,
    ).get(
      params.runId,
      context.content_hash,
    ) as { id: string } | undefined;
    let reason: ContextDeliveryDecision["reason"] = duplicate
      ? "exact_duplicate_active"
      : "new_delivery";

    if (!duplicate && context.kind === "file") {
      duplicate = this.db.prepare(
        `SELECT d.id
         FROM context_deliveries d
         JOIN context_item_versions v ON v.id = d.context_item_version_id
         JOIN context_items ci ON ci.id = v.context_item_id
         WHERE d.run_id = ? AND d.presence_state = 'active'
           AND d.supplied_to_agent = 1 AND v.source_path = ?
           AND ci.kind <> 'file'
         ORDER BY d.delivered_at DESC LIMIT 1`,
      ).get(
        params.runId,
        context.source_path,
      ) as { id: string } | undefined;
      if (duplicate) reason = "equivalent_symbol_active";
    }

    const deliveryId = crypto.randomUUID();
    const suppliedToAgent = !duplicate;
    const deliveredAt = now();

    this.db.prepare(
      `INSERT INTO context_deliveries (
        id, run_id, packet_id, context_item_version_id, delivery_stage,
        estimated_tokens, delivered_at, was_duplicate,
        duplicate_of_delivery_id, supplied_to_agent, presence_state,
        content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      deliveryId,
      params.runId,
      params.packetId,
      params.contextItemVersionId,
      params.stage,
      params.estimatedTokens,
      deliveredAt,
      duplicate ? 1 : 0,
      duplicate?.id ?? null,
      suppliedToAgent ? 1 : 0,
      suppliedToAgent ? "active" : "unknown",
      context.content_hash,
    );

    const delivery: RunContextLedgerEntry = {
      deliveryId,
      runId: params.runId,
      packetId: params.packetId,
      contextItemVersionId: params.contextItemVersionId,
      contentHash: context.content_hash,
      deliveredAt,
      estimatedTokens: params.estimatedTokens,
      stage: params.stage,
      presenceState: suppliedToAgent ? "active" : "unknown",
      duplicateOf: duplicate?.id,
      suppliedToAgent,
    };

    return {
      suppliedToAgent,
      reason,
      duplicateOfDeliveryId: duplicate?.id,
      delivery,
    };
  }

  setPresence(
    deliveryId: string,
    state: ContextPresenceState,
    supersededByCheckpointId?: string,
  ): void {
    this.db.prepare(
      `UPDATE context_deliveries
       SET presence_state = ?, superseded_by_checkpoint_id = ?
       WHERE id = ?`,
    ).run(state, supersededByCheckpointId ?? null, deliveryId);
  }

  findByRunId(runId: string): RunContextLedgerEntry[] {
    const rows = this.db.prepare(
      `SELECT * FROM context_deliveries
       WHERE run_id = ? ORDER BY delivered_at, id`,
    ).all(runId) as unknown as DeliveryRow[];

    return rows.map((row) => ({
      deliveryId: row.id,
      runId: row.run_id,
      packetId: row.packet_id,
      contextItemVersionId: row.context_item_version_id,
      contentHash: row.content_hash,
      deliveredAt: row.delivered_at,
      estimatedTokens: row.estimated_tokens,
      stage: row.delivery_stage,
      presenceState: row.presence_state,
      duplicateOf: row.duplicate_of_delivery_id ?? undefined,
      supersededByCheckpointId:
        row.superseded_by_checkpoint_id ?? undefined,
      suppliedToAgent: row.supplied_to_agent === 1,
    }));
  }

  getPacketAccounting(runId: string): ContextPacketTokenAccounting[] {
    const rows = this.db.prepare(
      `SELECT accounting_json FROM context_packets
       WHERE run_id = ? ORDER BY created_at, id`,
    ).all(runId) as unknown as { accounting_json: string }[];
    return rows.map(
      (row) => JSON.parse(row.accounting_json) as ContextPacketTokenAccounting,
    );
  }
}
