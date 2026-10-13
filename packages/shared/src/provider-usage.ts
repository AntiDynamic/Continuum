export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  totalTokens: number | null;
  accumulation: "per_step" | "accumulated";
  inputIncludesCached: boolean | null;
  outputIncludesThinking: boolean | null;
}

const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
export function normalizeProviderUsage(raw: Record<string, unknown>, semantics: Pick<ProviderUsage, "accumulation" | "inputIncludesCached" | "outputIncludesThinking">): ProviderUsage {
  const field = (...keys: string[]) => { for (const key of keys) { const value = finite(raw[key]); if (value !== null) return value; } return null; };
  return { inputTokens: field("inputTokens", "input_tokens", "promptTokens", "prompt_tokens"), outputTokens: field("outputTokens", "output_tokens", "completionTokens", "completion_tokens"), thinkingTokens: field("thinkingTokens", "thinking_tokens", "reasoningTokens", "reasoning_tokens"), cacheReadTokens: field("cacheReadTokens", "cache_read_tokens", "cachedInputTokens", "cached_input_tokens"), cacheCreationTokens: field("cacheCreationTokens", "cacheCreationInputTokens", "cache_creation_input_tokens"), totalTokens: field("totalTokens", "total_tokens", "total"), ...semantics };
}

export function aggregateProviderUsage(samples: ProviderUsage[]): ProviderUsage | null {
  if (!samples.length) return null;
  const mode = samples[0]!.accumulation;
  if (samples.some(sample => sample.accumulation !== mode || sample.inputIncludesCached !== samples[0]!.inputIncludesCached || sample.outputIncludesThinking !== samples[0]!.outputIncludesThinking)) throw new Error("Usage event semantics changed within one run");
  if (mode === "accumulated") return samples.at(-1)!;
  const sum = (key: "inputTokens" | "outputTokens" | "thinkingTokens" | "cacheReadTokens" | "cacheCreationTokens" | "totalTokens") => samples.some(sample => sample[key] === null) ? null : samples.reduce((total, sample) => total + sample[key]!, 0);
  return { ...samples[0]!, inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), thinkingTokens: sum("thinkingTokens"), cacheReadTokens: sum("cacheReadTokens"), cacheCreationTokens: sum("cacheCreationTokens"), totalTokens: sum("totalTokens") };
}

export interface ProviderPriceProfile { id: string; provider: string; model: string; version: string; effectiveFrom: string; currency: string; inputPerMillion: number; outputPerMillion: number; cachedInputPerMillion?: number; cacheCreationPerMillion?: number; thinkingPerMillion?: number }
export function priceProviderUsage(usage: ProviderUsage | null, profile: ProviderPriceProfile | null, identity: { provider: string; model: string; observedAt: string }): { profileId: string; currency: string; total: number; measurement: "derived"; components: Record<string, number> } | null {
  if (!usage || !profile || !profile.id || !profile.version || !profile.currency || profile.provider !== identity.provider || profile.model !== identity.model || !Number.isFinite(Date.parse(profile.effectiveFrom)) || Date.parse(profile.effectiveFrom) > Date.parse(identity.observedAt)) return null;
  if (usage.inputTokens === null || usage.outputTokens === null || usage.inputIncludesCached === null || usage.outputIncludesThinking === null) return null;
  // Unknown cache/reasoning counts cannot be silently treated as zero.
  if (usage.cacheReadTokens === null || usage.cacheCreationTokens === null || (!usage.outputIncludesThinking && usage.thinkingTokens === null)) return null;
  const rates = [profile.inputPerMillion, profile.outputPerMillion];
  if (usage.cacheReadTokens > 0) rates.push(profile.cachedInputPerMillion!);
  if (usage.cacheCreationTokens > 0) rates.push(profile.cacheCreationPerMillion!);
  if (!usage.outputIncludesThinking && (usage.thinkingTokens ?? 0) > 0) rates.push(profile.thinkingPerMillion!);
  if (rates.some(rate => finite(rate) === null)) return null;
  const uncached = usage.inputTokens - (usage.inputIncludesCached ? usage.cacheReadTokens + usage.cacheCreationTokens : 0);
  if (uncached < 0) return null;
  const components = { input: uncached * profile.inputPerMillion / 1e6, output: usage.outputTokens * profile.outputPerMillion / 1e6, cachedInput: usage.cacheReadTokens * (profile.cachedInputPerMillion ?? 0) / 1e6, cacheCreation: usage.cacheCreationTokens * (profile.cacheCreationPerMillion ?? 0) / 1e6, thinking: usage.outputIncludesThinking ? 0 : (usage.thinkingTokens ?? 0) * (profile.thinkingPerMillion ?? 0) / 1e6 };
  return { profileId: profile.id, currency: profile.currency, components, total: Object.values(components).reduce((total, value) => total + value, 0), measurement: "derived" };
}
