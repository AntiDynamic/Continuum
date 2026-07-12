/**
 * Opt-in real Gemini CLI smoke test.
 *
 * This test is EXCLUDED from the normal test suite and requires:
 *   CONTINUUM_REAL_GEMINI_TEST=1
 *   GEMINI_API_KEY=<valid key>
 *
 * Run with:
 *   pnpm test:gemini-smoke
 *
 * It sends the smallest possible prompt to verify stream-json parsing works
 * with the actual installed CLI version.  Avoid running repeatedly to
 * minimise API quota usage.
 */

import { describe, it, expect } from "vitest";

const RUN_SMOKE = process.env["CONTINUUM_REAL_GEMINI_TEST"] === "1";

describe.skipIf(!RUN_SMOKE)("Gemini CLI smoke test [real]", () => {
  it("detects Gemini CLI availability", async () => {
    const { GeminiAdapter } = await import("../src/gemini-adapter.js");
    const adapter = new GeminiAdapter();
    const availability = await adapter.detectAvailability();
    expect(availability.available).toBe(true);
    console.log("Gemini version:", availability.version);
    console.log("Executable:", availability.executablePath);
  });

  it("streams a minimal response in stream-json mode", async () => {
    const { GeminiAdapter } = await import("../src/gemini-adapter.js");
    const adapter = new GeminiAdapter();

    const events = [];
    for await (const event of adapter.run({
      runId: "smoke-test-001",
      task: 'Reply only with the word "OK" and nothing else.',
      repositoryPath: process.cwd(),
      workingDirectory: process.cwd(),
      timeoutMs: 60_000,
      policy: {
        captureRawOutput: false,
        redactPatterns: [],
        unsafeAutoApprove: false,
        initializationTimeoutMs: 5000,
      }
    })) {
      events.push(event);
      console.log(`  [${event.eventType}]`);
    }

    const types = new Set(events.map((e) => e.eventType));
    expect(types.has("run_started")).toBe(true);
    // Either run_completed or run_failed should appear
    const terminal = events.find(
      (e) => e.eventType === "run_completed" || e.eventType === "run_failed",
    );
    expect(terminal).toBeDefined();

    console.log(`Total events: ${events.length.toString()}`);
    console.log("Event types:", [...types].join(", "));
  }, 90_000);
});
