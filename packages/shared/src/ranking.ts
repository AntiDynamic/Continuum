import type { ContextItemVersion } from "./context-domain.js";

export interface ScoreComponent {
  name: string;
  value: number;
  weight: number;
  weightedScore: number;
}

export interface RankedResult {
  version: ContextItemVersion;
  finalScore: number;
  components: ScoreComponent[];
  rank: number;
}

export interface RankingWeights {
  bm25: number;
  exactMatch: number;
  freshness: number;
  lengthPenalty: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  bm25: 1.0,
  exactMatch: 2.0,
  freshness: 0.5,
  lengthPenalty: -0.2,
};

export function rankResults(
  query: string,
  rawResults: { version: ContextItemVersion; score: number }[],
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS
): RankedResult[] {
  const ranked = rawResults.map((result) => {
    const components: ScoreComponent[] = [];
    
    // BM25 / Retrieval Score
    const bm25Score = result.score;
    components.push({
      name: "bm25",
      value: bm25Score,
      weight: weights.bm25,
      weightedScore: bm25Score * weights.bm25,
    });

    // Exact Match in title/symbol
    const queryLower = query.toLowerCase();
    let exactMatchScore = 0;
    if (result.version.symbol_name?.toLowerCase().includes(queryLower)) {
      exactMatchScore += 1.0;
    }
    if (result.version.title?.toLowerCase().includes(queryLower)) {
      exactMatchScore += 0.5;
    }
    components.push({
      name: "exact_match",
      value: exactMatchScore,
      weight: weights.exactMatch,
      weightedScore: exactMatchScore * weights.exactMatch,
    });

    // Freshness (simulated based on indexed_at vs now)
    // For simplicity, we just check if it's 'fresh' vs 'stale'
    const freshnessScore = result.version.staleness_status === "current" ? 1.0 : 0.0;
    components.push({
      name: "freshness",
      value: freshnessScore,
      weight: weights.freshness,
      weightedScore: freshnessScore * weights.freshness,
    });

    // Length Penalty (penalize very long context to save tokens)
    // 1000 characters is the baseline. 
    const lengthRatio = Math.max(0, (result.version.content.length - 1000) / 5000);
    // capped at 1.0 penalty value
    const lengthPenaltyValue = Math.min(1.0, lengthRatio);
    components.push({
      name: "length_penalty",
      value: lengthPenaltyValue,
      weight: weights.lengthPenalty, // typically negative
      weightedScore: lengthPenaltyValue * weights.lengthPenalty,
    });

    const finalScore = components.reduce((sum, c) => sum + c.weightedScore, 0);

    return {
      version: result.version,
      finalScore,
      components,
      rank: 0, // Assigned after sort
    };
  });

  // Sort descending by finalScore
  ranked.sort((a, b) => b.finalScore - a.finalScore);

  // Assign ranks
  ranked.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  return ranked;
}
