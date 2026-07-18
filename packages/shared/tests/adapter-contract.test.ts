import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentAdapter, AgentRunInput, AgentEvent } from "../src/index.js";

export type AdapterContractScenario =
  | "success"
  | "failure"
  | "secret-output"
  | "unknown-event"
  | "malformed-output"
  | "timeout"
  | "cancellation"
  | "heavy-dual-stream";

export interface AgentAdapterContractHarness {
  adapter: AgentAdapter;
  createInput(overrides?: Partial<AgentRunInput>): AgentRunInput;
  configureScenario?(scenario: AdapterContractScenario): Promise<void>;
  cleanup(): Promise<void>;
}

export function defineAgentAdapterContract(
  name: string,
  createHarness: () => Promise<AgentAdapterContractHarness>
): void {
  describe(`AgentAdapter Contract: ${name}`, () => {
    let harness: AgentAdapterContractHarness;

    beforeEach(async () => {
      harness = await createHarness();
    });

    afterEach(async () => {
      if (harness.cleanup) {
        await harness.cleanup();
      }
    });

    async function runScenario(
      scenario: AdapterContractScenario,
      inputOverrides?: Partial<AgentRunInput>
    ): Promise<AgentEvent[]> {
      if (harness.configureScenario) {
        await harness.configureScenario(scenario);
      }
      const input = harness.createInput(inputOverrides);
      const events: AgentEvent[] = [];
      try {
        for await (const evt of harness.adapter.run(input)) {
          events.push(evt);
        }
      } catch (err) {
        // We let the adapter throw or not, but we inspect the events yielded before the error.
        // A well-behaved adapter should yield run_failed instead of throwing.
      }
      return events;
    }

    describe("Lifecycle", () => {
      it("should emit exactly one terminal event (run_completed or run_failed) at the end (success)", async () => {
        const events = await runScenario("success");
        expect(events.length).toBeGreaterThan(0);
        expect(events[0].eventType).toBe("run_started");

        const terminalEvents = events.filter(
          (e) => e.eventType === "run_completed" || e.eventType === "run_failed"
        );
        expect(terminalEvents).toHaveLength(1);
        expect(terminalEvents[0].eventType).toBe("run_completed");
        expect(events.at(-1)).toBe(terminalEvents[0]);

        // Sequence numbers
        const seqs = events.map((e) => e.sequenceNumber);
        expect(new Set(seqs).size).toBe(events.length);
        const sortedSeqs = [...seqs].sort((a, b) => a - b);
        expect(seqs).toEqual(sortedSeqs);

        // Event IDs
        const eventIds = events.map((e) => e.eventId);
        expect(new Set(eventIds).size).toBe(events.length);
      });

      it("should emit exactly one terminal event (run_completed or run_failed) at the end (failure)", async () => {
        const events = await runScenario("failure");
        expect(events.length).toBeGreaterThan(0);
        
        const terminalEvents = events.filter(
          (e) => e.eventType === "run_completed" || e.eventType === "run_failed"
        );
        expect(terminalEvents).toHaveLength(1);
        expect(terminalEvents[0].eventType).toBe("run_failed");
        expect(events.at(-1)).toBe(terminalEvents[0]);
      });
      
      it("should emit run_failed on timeout", async () => {
        const events = await runScenario("timeout", { policy: { initializationTimeoutMs: 100, captureRawOutput: false, redactPatterns: [], unsafeAutoApprove: false } });
        const terminalEvents = events.filter(
          (e) => e.eventType === "run_completed" || e.eventType === "run_failed"
        );
        expect(terminalEvents).toHaveLength(1);
        expect(terminalEvents[0].eventType).toBe("run_failed");
      });

      it("should emit run_failed on cancellation", async () => {
        if (harness.configureScenario) {
          await harness.configureScenario("cancellation");
        }
        const input = harness.createInput();
        const events: AgentEvent[] = [];
        const runPromise = (async () => {
          for await (const evt of harness.adapter.run(input)) {
            events.push(evt);
            if (evt.eventType === "run_started") {
              await harness.adapter.cancel(input.runId);
            }
          }
        })();
        await runPromise;

        const terminalEvents = events.filter(
          (e) => e.eventType === "run_completed" || e.eventType === "run_failed"
        );
        expect(terminalEvents).toHaveLength(1);
        expect(terminalEvents[0].eventType).toBe("run_failed");
      });
      
      it("should preserve unknown events without crashing", async () => {
        const events = await runScenario("unknown-event");
        const unknown = events.find(e => e.eventType === "unknown_agent_event");
        expect(unknown).toBeDefined();
        
        const terminalEvents = events.filter(
          (e) => e.eventType === "run_completed" || e.eventType === "run_failed"
        );
        expect(terminalEvents).toHaveLength(1);
      });

      it("should handle malformed output without crashing", async () => {
        const events = await runScenario("malformed-output");
        
        const terminalEvents = events.filter(
          (e) => e.eventType === "run_completed" || e.eventType === "run_failed"
        );
        expect(terminalEvents).toHaveLength(1);
      });
    });

    describe("Raw Output Policy", () => {
      it("should provide raw output when captureRawOutput is true", async () => {
        const events = await runScenario("success", {
          policy: {
            captureRawOutput: true,
            redactPatterns: [],
            unsafeAutoApprove: false,
            initializationTimeoutMs: 5000,
          },
        });
        
        const payloadsWithRaw = events.filter(e => (e.payload as any)?.raw !== undefined || (e.payload as any)?.line !== undefined);
        expect(payloadsWithRaw.length).toBeGreaterThan(0);
      });

      it("should omit raw output when captureRawOutput is false", async () => {
        const events = await runScenario("success", {
          policy: {
            captureRawOutput: false,
            redactPatterns: [],
            unsafeAutoApprove: false,
            initializationTimeoutMs: 5000,
          },
        });
        
        const payloadsWithRaw = events.filter(e => (e.payload as any)?.raw !== undefined || (e.payload as any)?.line !== undefined);
        expect(payloadsWithRaw.length).toBe(0);
        
        // Structured metrics (like tool calls) should still be present
        const toolCalls = events.filter(e => e.eventType === "tool_call");
        // We can't guarantee mock has tool calls, but if it does, they shouldn't have raw
        if (toolCalls.length > 0) {
            expect((toolCalls[0].payload as any).raw).toBeUndefined();
        }
      });
    });

    describe("Redaction", () => {
      it("should redact CONTINUUM_TEST_SECRET_9f73a1 in all outputs when captureRawOutput is true", async () => {
        const secret = "CONTINUUM_TEST_SECRET_9f73a1";
        const events = await runScenario("secret-output", {
          policy: {
            captureRawOutput: true,
            redactPatterns: [secret],
            unsafeAutoApprove: false,
            initializationTimeoutMs: 5000,
          },
        });

        const serialized = JSON.stringify(events);
        expect(serialized).not.toContain(secret);
      });

      it("should redact CONTINUUM_TEST_SECRET_9f73a1 in all outputs when captureRawOutput is false", async () => {
        const secret = "CONTINUUM_TEST_SECRET_9f73a1";
        const events = await runScenario("secret-output", {
          policy: {
            captureRawOutput: false,
            redactPatterns: [secret],
            unsafeAutoApprove: false,
            initializationTimeoutMs: 5000,
          },
        });

        const serialized = JSON.stringify(events);
        expect(serialized).not.toContain(secret);
      });
    });
  });
}

describe("Mock Adapter Contract Execution", () => {
  class MockAdapter implements AgentAdapter {
    id = "mock";
    displayName = "Mock Adapter";
    private scenario: AdapterContractScenario = "success";

    async detectAvailability() { return { available: true }; }
    async getCapabilities() { return { structuredOutput: true, streamingOutput: true, tokenUsage: true, toolEvents: true, sessionId: true, cancellation: true, telemetry: { reportsInputTokens: true, reportsCachedInputTokens: true, reportsOutputTokens: true, reportsReasoningTokens: false, reportsToolUsage: true, reportsModelIdentity: true } }; }
    
    setScenario(scenario: AdapterContractScenario) {
      this.scenario = scenario;
    }

    async cancel(runId: string) {
       this.scenario = "cancellation";
    }

    async *run(input: AgentRunInput) {
      let seq = 1;
      const emit = (type: string, payload: any) => ({
        eventId: "e-" + seq,
        runId: input.runId,
        sequenceNumber: seq++,
        timestamp: new Date().toISOString(),
        source: "agent",
        eventType: type,
        redactionApplied: false,
        payload,
      } as unknown as AgentEvent);

      yield emit("run_started", { raw: input.policy.captureRawOutput ? "raw" : undefined });

      if (this.scenario === "timeout") {
        await new Promise(r => setTimeout(r, 200));
        yield emit("run_failed", { failureKind: "timeout", raw: input.policy.captureRawOutput ? "raw" : undefined });
        return;
      }

      if (this.scenario === "cancellation") {
        yield emit("run_failed", { failureKind: "cancelled", raw: input.policy.captureRawOutput ? "raw" : undefined });
        return;
      }

      if (this.scenario === "secret-output") {
        const secret = "CONTINUUM_TEST_SECRET_9f73a1";
        const redacted = "[REDACTED]";
        const out = input.policy.redactPatterns?.includes(secret) ? redacted : secret;
        
        yield emit("agent_message", { 
          text: `My secret is ${out}`, 
          raw: input.policy.captureRawOutput ? `Raw: ${out}` : undefined 
        });
        
        yield emit("tool_call", {
          toolName: "run",
          toolCallId: "123",
          input: { key: out },
          raw: input.policy.captureRawOutput ? `Raw: ${out}` : undefined
        });
        
        yield emit("stderr", {
          line: input.policy.captureRawOutput ? `Error: ${out}` : undefined
        });
      }

      if (this.scenario === "unknown-event") {
        yield emit("unknown_agent_event", { originalType: "magic", parseStatus: "partial", raw: input.policy.captureRawOutput ? "raw" : undefined });
      }

      if (this.scenario === "failure") {
        yield emit("run_failed", { exitCode: 1, durationMs: 100, raw: input.policy.captureRawOutput ? "raw" : undefined });
      } else {
        yield emit("run_completed", { exitCode: 0, durationMs: 100, raw: input.policy.captureRawOutput ? "raw" : undefined });
      }
    }
  }

  defineAgentAdapterContract("MockAdapter", async () => {
    const adapter = new MockAdapter();
    return {
      adapter,
      createInput: (overrides) => ({
        runId: "test-run",
        task: "test",
        workingDirectory: "/tmp",
        repositoryPath: "/tmp",
        policy: { captureRawOutput: false, redactPatterns: [], unsafeAutoApprove: false, initializationTimeoutMs: 5000 },
        ...overrides,
      }),
      configureScenario: async (scenario) => {
        adapter.setScenario(scenario);
      },
      cleanup: async () => {},
    };
  });
});
