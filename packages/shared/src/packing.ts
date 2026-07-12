import type { RankedResult } from "./ranking.js";

export interface ContextPacket {
  items: RankedResult[];
  totalCharacters: number;
  totalItems: number;
  overflowItems: number;
}

export interface PackingBudget {
  maxCharacters: number;
  maxItems: number;
}

export const DEFAULT_BUDGET: PackingBudget = {
  maxCharacters: 32000, // roughly 8000 tokens
  maxItems: 50,
};

export function packContext(
  rankedResults: RankedResult[],
  budget: PackingBudget = DEFAULT_BUDGET
): ContextPacket {
  const items: RankedResult[] = [];
  let currentChars = 0;
  let overflowItems = 0;

  for (const result of rankedResults) {
    if (items.length >= budget.maxItems) {
      overflowItems++;
      continue;
    }

    const itemChars = result.version.content.length;

    // We always include at least the first item if possible, 
    // but if it's too big, we might still include it if items is empty
    if (items.length > 0 && currentChars + itemChars > budget.maxCharacters) {
      overflowItems++;
      continue;
    }

    items.push(result);
    currentChars += itemChars;
  }

  return {
    items,
    totalCharacters: currentChars,
    totalItems: items.length,
    overflowItems,
  };
}
