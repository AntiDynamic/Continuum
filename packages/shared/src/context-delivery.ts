export type ContextDeliveryMode = "none" | "mcp" | "preflight" | "preflight_mcp";
export type ContextCacheObservation = "not_requested" | "unsupported" | "not_reported" | "created" | "read";

/** Capabilities of the host path that places Continuum context in an agent run. */
export interface ContextDeliveryCapabilities {
  host: string;
  preflightInjection: boolean;
  targetedMcp: boolean;
  stablePrefixReuse: boolean;
  explicitPromptCache: boolean;
  cachedInputTelemetry: boolean;
  cacheCreationTelemetry: boolean;
  nativeCompaction: boolean;
  evidence: "declared" | "observed" | "unavailable";
}

/** Evidence recorded for one provider/host delivery attempt. */
export interface ContextDeliveryReceipt {
  schemaVersion: "continuum.context-delivery-receipt.v1";
  host: string;
  mode: ContextDeliveryMode;
  stablePrefix: { contentHash: string | null; estimatedTokens: number; sent: boolean; reused: boolean };
  taskDelta: { contentHash: string | null; estimatedTokens: number; sent: boolean };
  cacheObservation: ContextCacheObservation;
  providerUsage: "available" | "unavailable";
  capabilities: ContextDeliveryCapabilities;
}

export const CONTEXT_DELIVERY_RECEIPT_SCHEMA_VERSION = "continuum.context-delivery-receipt.v1" as const;
