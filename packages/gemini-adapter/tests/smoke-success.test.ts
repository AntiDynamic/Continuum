import { describe, it, expect } from "vitest";

const RUN_SUCCESS_SMOKE = process.env["CONTINUUM_REAL_GEMINI_SUCCESS_TEST"] === "1";

describe.skipIf(!RUN_SUCCESS_SMOKE)("Gemini CLI smoke test [success]", () => {
  it("completes a successful gemini request", async () => {
    const { GeminiAdapter } = await import("../src/gemini-adapter.js");
    const adapter = new GeminiAdapter();

    const events = [];
    for await (const event of adapter.run({
      runId: "smoke-success-001",
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
    }

    const terminal = events.find(
      (e) => e.eventType === "run_completed" || e.eventType === "run_failed",
    );
    expect(terminal).toBeDefined();
    expect(terminal?.eventType).toBe("run_completed");
    
    // Additional success checks
    if (terminal?.eventType === "run_completed") {
      expect(terminal.payload.exitCode).toBe(0);
    }
  }, 90_000);
});
