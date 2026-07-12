import { describe, it, expect } from "vitest";
import { rankResults, DEFAULT_RANKING_WEIGHTS } from "../src/ranking.js";
import type { ContextItemVersion } from "../src/context-domain.js";

function createDummyVersion(overrides: Partial<ContextItemVersion> = {}): ContextItemVersion {
  return {
    id: "v1",
    context_item_id: "c1",
    content: "function test() {}",
    source_path: "test.ts",
    source_start_line: 1,
    source_end_line: 1,
    language: "ts",
    content_hash: "hash",
    source_blob_hash: "blob",
    valid_from_commit: "commit",
    indexed_at: new Date().toISOString(),
    staleness_status: "fresh",
    ...overrides
  };
}

describe("ranking", () => {
  it("prioritizes exact matches", () => {
    const rawResults = [
      { version: createDummyVersion({ id: "1", symbol_name: "somethingElse", title: "Something Else" }), score: 10 },
      { version: createDummyVersion({ id: "2", symbol_name: "myFunction", title: "My Function" }), score: 10 },
    ];

    const ranked = rankResults("myFunction", rawResults, DEFAULT_RANKING_WEIGHTS);

    expect(ranked[0].version.id).toBe("2");
    expect(ranked[1].version.id).toBe("1");
    expect(ranked[0].finalScore).toBeGreaterThan(ranked[1].finalScore);
  });

  it("penalizes long content", () => {
    const shortContent = "short";
    const longContent = "long".repeat(1500); // 6000 chars

    const rawResults = [
      { version: createDummyVersion({ id: "1", content: longContent }), score: 10 },
      { version: createDummyVersion({ id: "2", content: shortContent }), score: 10 },
    ];

    const ranked = rankResults("query", rawResults, DEFAULT_RANKING_WEIGHTS);

    // short should be ranked higher due to length penalty on long
    expect(ranked[0].version.id).toBe("2");
    expect(ranked[1].version.id).toBe("1");
  });
});
