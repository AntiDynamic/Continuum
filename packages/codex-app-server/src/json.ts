/** Narrow shape for untrusted App Server JSON. Every field remains unknown until checked. */
export interface JsonRecord extends Record<string, unknown> {
  account?: unknown; changes?: unknown; codexHome?: unknown; command?: unknown; cwd?: unknown;
  diff?: unknown; durationMs?: unknown; exitCode?: unknown; expected?: unknown; id?: unknown;
  inputTokens?: unknown; cachedInputTokens?: unknown; outputTokens?: unknown;
  reasoningOutputTokens?: unknown; totalTokens?: unknown; item?: unknown; itemId?: unknown;
  method?: unknown; model?: unknown; modelProvider?: unknown; params?: unknown; phase?: unknown;
  platformFamily?: unknown; platformOs?: unknown; requiresOpenaiAuth?: unknown; source?: unknown;
  status?: unknown; text?: unknown; thread?: unknown; threadId?: unknown; tokenUsage?: unknown;
  total?: unknown; turn?: unknown; turnId?: unknown; type?: unknown; userAgent?: unknown;
}

export const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
