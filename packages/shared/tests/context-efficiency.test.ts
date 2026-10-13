import { describe, expect, it } from "vitest";
import {
  CharacterRatioTokenEstimator,
  buildContextPacketAccounting,
  calculateRunCostEvidence,
} from "../src/context-efficiency.js";

describe("context efficiency evidence", () => {
  it("uses a conservative deterministic token estimate", () => {
    const estimator = new CharacterRatioTokenEstimator();
    expect(estimator.estimate("")).toBe(0);
    expect(estimator.estimate("abcdef")).toBe(2);
    expect(estimator.estimate("abcdef")).toBe(estimator.estimate("abcdef"));
  });

  it("accounts for packet categories without claiming savings", () => {
    const accounting = buildContextPacketAccounting({
      metadata: ["path:a.ts"],
      code: ["export const a = 1;"],
      documentation: ["# Guide"],
      tests: ["expect(a).toBe(1)"],
      duplicateContent: ["export const a = 1;"],
      historicalExcluded: ["old implementation"],
      staleExcluded: ["stale docs"],
    });

    expect(accounting.measurement).toBe("estimated");
    expect(accounting.totalEstimatedTokens).toBe(accounting.newTokensDelivered);
    expect(accounting.potentialDuplicateTokensAvoided).toBeGreaterThan(0);
    expect(accounting.historicalTokensExcluded).toBeGreaterThan(0);
    expect(accounting.staleTokensExcluded).toBeGreaterThan(0);
    expect(accounting.baselineStatus).toBe("no_valid_baseline");
    expect("savings" in accounting).toBe(false);
  });

  it("distinguishes derived, estimated, and unavailable cost", () => {
    const pricing = {
      provider: "test",
      model: "model",
      inputCreditsPerMillionTokens: 2,
      cachedInputCreditsPerMillionTokens: 1,
      cacheCreationInputCreditsPerMillionTokens: 3,
      outputCreditsPerMillionTokens: 4,
      source: "user_configured" as const,
    };

    const derived = calculateRunCostEvidence(
      "run-derived",
      {
        inputTokens: 1_000_000,
        cachedInputTokens: 500_000,
        cacheCreationInputTokens: 250_000,
        outputTokens: 250_000,
        totalTokens: 1_750_000,
        measurement: "provider_reported",
      },
      pricing,
    );
    expect(derived.measurement).toBe("derived");
    expect(derived.cacheCreationInputCredits).toBe(0.75);
    expect(derived.totalCredits).toBe(4.25);

    const estimated = calculateRunCostEvidence(
      "run-estimated",
      { inputTokens: 1_000_000, measurement: "estimated" },
      pricing,
    );
    expect(estimated.measurement).toBe("estimated");
    expect(estimated.totalCredits).toBe(2);

    const unavailable = calculateRunCostEvidence(
      "run-unavailable",
      { measurement: "unavailable" },
      pricing,
    );
    expect(unavailable.measurement).toBe("unavailable");
    expect(unavailable.totalCredits).toBeUndefined();
    const partial = calculateRunCostEvidence("partial", {
      inputTokens: 100, outputTokens: 20, measurement: "provider_reported",
    }, { ...pricing, outputCreditsPerMillionTokens: undefined });
    expect(partial.measurement).toBe("unavailable");
    expect(partial.totalCredits).toBeUndefined();
  });
});
