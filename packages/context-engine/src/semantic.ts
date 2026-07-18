import type { SemanticIndexItem, SemanticRetriever, SemanticSearchOptions, SemanticSearchResult } from "@continuum/shared";

export class DisabledSemanticRetriever implements SemanticRetriever {
  readonly id = "disabled";
  async isAvailable(): Promise<boolean> { return false; }
  async index(_items: SemanticIndexItem[]): Promise<void> { return; }
  async search(_query: string, _options: SemanticSearchOptions): Promise<SemanticSearchResult[]> { return []; }
}

export function normalizeFtsBm25(rawScore: number): number {
  const strength = Math.max(0, -rawScore);
  return strength / (1 + strength);
}
