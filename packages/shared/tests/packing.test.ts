import { describe, it, expect } from "vitest";
import { packContext } from "../src/packing.js";
import type { RankedResult } from "../src/ranking.js";
import type { ContextItemVersion } from "../src/context-domain.js";

function createMockRanked(id: string, contentLength: number): RankedResult {
  return {
    version: {
      id,
      content: "a".repeat(contentLength),
    } as ContextItemVersion,
    finalScore: 10,
    components: [],
    rank: 1
  };
}

describe("packing", () => {
  it("packs items within budget", () => {
    const items = [
      createMockRanked("1", 100),
      createMockRanked("2", 100),
      createMockRanked("3", 100)
    ];

    const packet = packContext(items, { maxCharacters: 250, maxItems: 10 });
    
    expect(packet.items.length).toBe(2);
    expect(packet.totalCharacters).toBe(200);
    expect(packet.overflowItems).toBe(1);
  });

  it("always includes at least the first item even if over character budget", () => {
    const items = [
      createMockRanked("1", 1000)
    ];

    const packet = packContext(items, { maxCharacters: 500, maxItems: 10 });
    
    expect(packet.items.length).toBe(1);
    expect(packet.totalCharacters).toBe(1000);
    expect(packet.overflowItems).toBe(0);
  });

  it("respects maxItems budget", () => {
    const items = [
      createMockRanked("1", 10),
      createMockRanked("2", 10),
      createMockRanked("3", 10)
    ];

    const packet = packContext(items, { maxCharacters: 1000, maxItems: 2 });
    
    expect(packet.items.length).toBe(2);
    expect(packet.overflowItems).toBe(1);
  });
});
