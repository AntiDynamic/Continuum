import { describe, it, expect } from "vitest";
import { ContinuumConfigSchema } from "../src/config.js";

describe("ContinuumConfigSchema", () => {
  it("accepts a valid config", () => {
    const result = ContinuumConfigSchema.parse({
      version: 1,
      defaultAgent: "gemini",
      testCommands: ["pnpm test"],
      buildCommands: [],
      redactPatterns: [],
      captureRawOutput: true,
    });
    expect(result.version).toBe(1);
    expect(result.defaultAgent).toBe("gemini");
  });

  it("applies defaults for optional fields", () => {
    const result = ContinuumConfigSchema.parse({ version: 1 });
    expect(result.testCommands).toEqual([]);
    expect(result.captureRawOutput).toBe(true);
  });

  it("rejects a wrong version", () => {
    expect(() => ContinuumConfigSchema.parse({ version: 2 })).toThrow();
  });

  it("rejects a missing version", () => {
    expect(() => ContinuumConfigSchema.parse({})).toThrow();
  });
});
