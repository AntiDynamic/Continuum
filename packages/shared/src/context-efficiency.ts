/**
 * Provider-neutral evidence contracts for context efficiency and task cost.
 *
 * Cost values in this module are always evidence-labelled. A calculated value
 * is never described as an actual provider charge.
 */

export interface ModelPricingProfile {
  provider: string;
  model: string;
  version?: string;

  inputCreditsPerMillionTokens?: number;
  cachedInputCreditsPerMillionTokens?: number;
  outputCreditsPerMillionTokens?: number;

  source: "provider_reported" | "user_configured" | "unknown";
  effectiveFrom?: string;
}

export interface StoredModelPricingProfile extends ModelPricingProfile {
  id: string;
  createdAt: string;
  effectiveFrom: string;
}

export interface AgentUsageEvidence {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  toolCalls?: number;

  measurement:
    | "provider_reported"
    | "agent_reported"
    | "estimated"
    | "unavailable";
}

export type ContextDeliveryStage =
  | "orientation"
  | "implementation"
  | "escalation"
  | "restoration";

export interface ContextDeliveryRecord {
  id: string;
  runId: string;
  packetId: string;

  contextItemVersionId: string;
  deliveryStage: ContextDeliveryStage;

  estimatedTokens: number;
  deliveredAt: string;

  wasDuplicate: boolean;
  duplicateOfDeliveryId?: string;

  suppliedToAgent: boolean;
}

export interface RunCostEvidence {
  runId: string;

  usage: AgentUsageEvidence;
  pricingProfile?: ModelPricingProfile;

  inputCredits?: number;
  cachedInputCredits?: number;
  outputCredits?: number;
  totalCredits?: number;

  measurement:
    | "measured"
    | "derived"
    | "estimated"
    | "unavailable";
}

export interface AgentTelemetryCapabilities {
  reportsInputTokens: boolean;
  reportsCachedInputTokens: boolean;
  reportsOutputTokens: boolean;
  reportsReasoningTokens: boolean;
  reportsToolUsage: boolean;
  reportsModelIdentity: boolean;
}

export interface TokenEstimator {
  readonly id: string;
  estimate(text: string): number;
}

/**
 * Conservative, deterministic approximation for code and prose.
 * Three UTF-16 code units per token intentionally rounds above the common
 * four-characters-per-token rule of thumb.
 */
export class CharacterRatioTokenEstimator implements TokenEstimator {
  readonly id = "character-ratio-v1";

  estimate(text: string): number {
    if (text.length === 0) return 0;
    return Math.ceil(text.length / 3);
  }
}

export interface ContextPacketTokenAccounting {
  estimatorId: string;
  measurement: "estimated";
  totalEstimatedTokens: number;
  metadataEstimatedTokens: number;
  codeEstimatedTokens: number;
  documentationEstimatedTokens: number;
  testEstimatedTokens: number;
  newTokensDelivered: number;
  potentialDuplicateTokensAvoided: number;
  historicalTokensExcluded: number;
  staleTokensExcluded: number;
  baselineStatus: "no_valid_baseline";
}

export type ContextPresenceState =
  | "active"
  | "checkpointed"
  | "expired"
  | "unknown";

export interface RunContextLedgerEntry {
  deliveryId: string;
  runId: string;
  contextItemVersionId: string;
  contentHash: string;

  deliveredAt: string;
  estimatedTokens: number;
  stage: ContextDeliveryStage;

  presenceState: ContextPresenceState;

  duplicateOf?: string;
  supersededByCheckpointId?: string;
  packetId: string;
  suppliedToAgent: boolean;
}

export type ContextDeliveryDecisionReason =
  | "new_delivery"
  | "exact_duplicate_active"
  | "equivalent_symbol_active";

export interface ContextDeliveryDecision {
  suppliedToAgent: boolean;
  reason: ContextDeliveryDecisionReason;
  duplicateOfDeliveryId?: string;
  delivery: RunContextLedgerEntry;
}

export interface ContextPacketAccountingInput {
  metadata: string[];
  code: string[];
  documentation: string[];
  tests: string[];
  duplicateContent?: string[];
  historicalExcluded?: string[];
  staleExcluded?: string[];
}

function estimateAll(estimator: TokenEstimator, values: string[]): number {
  return values.reduce((total, value) => total + estimator.estimate(value), 0);
}

export function buildContextPacketAccounting(
  input: ContextPacketAccountingInput,
  estimator: TokenEstimator = new CharacterRatioTokenEstimator(),
): ContextPacketTokenAccounting {
  const metadataEstimatedTokens = estimateAll(estimator, input.metadata);
  const codeEstimatedTokens = estimateAll(estimator, input.code);
  const documentationEstimatedTokens = estimateAll(estimator, input.documentation);
  const testEstimatedTokens = estimateAll(estimator, input.tests);
  const newTokensDelivered =
    metadataEstimatedTokens +
    codeEstimatedTokens +
    documentationEstimatedTokens +
    testEstimatedTokens;

  return {
    estimatorId: estimator.id,
    measurement: "estimated",
    totalEstimatedTokens: newTokensDelivered,
    metadataEstimatedTokens,
    codeEstimatedTokens,
    documentationEstimatedTokens,
    testEstimatedTokens,
    newTokensDelivered,
    potentialDuplicateTokensAvoided: estimateAll(
      estimator,
      input.duplicateContent ?? [],
    ),
    historicalTokensExcluded: estimateAll(
      estimator,
      input.historicalExcluded ?? [],
    ),
    staleTokensExcluded: estimateAll(estimator, input.staleExcluded ?? []),
    baselineStatus: "no_valid_baseline",
  };
}

function creditsFor(
  tokens: number | undefined,
  rate: number | undefined,
): number | undefined {
  if (tokens === undefined || rate === undefined) return undefined;
  return (tokens * rate) / 1_000_000;
}

export function calculateRunCostEvidence(
  runId: string,
  usage: AgentUsageEvidence,
  pricingProfile?: ModelPricingProfile,
): RunCostEvidence {
  if (usage.measurement === "unavailable" || !pricingProfile) {
    return {
      runId,
      usage,
      pricingProfile,
      measurement: "unavailable",
    };
  }

  const inputCredits = creditsFor(
    usage.inputTokens,
    pricingProfile.inputCreditsPerMillionTokens,
  );
  const cachedInputCredits = creditsFor(
    usage.cachedInputTokens,
    pricingProfile.cachedInputCreditsPerMillionTokens,
  );
  const outputCredits = creditsFor(
    usage.outputTokens,
    pricingProfile.outputCreditsPerMillionTokens,
  );
  const parts = [inputCredits, cachedInputCredits, outputCredits].filter(
    (value): value is number => value !== undefined,
  );

  if (parts.length === 0) {
    return {
      runId,
      usage,
      pricingProfile,
      measurement: "unavailable",
    };
  }

  return {
    runId,
    usage,
    pricingProfile,
    inputCredits,
    cachedInputCredits,
    outputCredits,
    totalCredits: parts.reduce((total, value) => total + value, 0),
    measurement: usage.measurement === "estimated" ? "estimated" : "derived",
  };
}
