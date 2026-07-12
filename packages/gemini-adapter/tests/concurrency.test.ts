import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeminiAdapter } from "../src/gemini-adapter.js";
import type { AgentRunInput, AgentEvent } from "@continuum/shared";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

vi.mock("execa", () => {
  return {
    execa: vi.fn(),
  };
});

import { execa } from "execa";

describe("GeminiAdapter Concurrency", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("consumes stdout and stderr concurrently without deadlock or loss", async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new PassThrough();
    mockChild.stderr = new PassThrough();
    mockChild.kill = vi.fn();
    mockChild.pid = 12345;
    
    // Make it a thenable for execa result
    const childPromise = Promise.resolve({ exitCode: 0, timedOut: false, isCanceled: false });
    Object.assign(mockChild, childPromise);
    mockChild.then = childPromise.then.bind(childPromise);
    mockChild.catch = childPromise.catch.bind(childPromise);
    mockChild.finally = childPromise.finally.bind(childPromise);

    (execa as any).mockReturnValue(mockChild);

    const adapter = new GeminiAdapter();
    adapter.detectAvailability = vi.fn().mockResolvedValue({ available: true });
    adapter.getCapabilities = vi.fn().mockResolvedValue({ defaultOutputMode: "stream-json" });

    const input: AgentRunInput = {
      runId: "run-concurrency",
      workingDirectory: __dirname,
      task: "test",
      prompt: "test",
      files: [],
      policy: {
        redactPatterns: [],
        captureRawOutput: true,
        initializationTimeoutMs: 15000,
        unsafeAutoApprove: false,
      },
    };

    const stream = adapter.run({ ...input });
    
    const events: AgentEvent[] = [];
    
    // Simulate streaming stdout and stderr
    const streamingPromise = (async () => {
      for (let i = 0; i < 500; i++) {
        mockChild.stdout.write(`stdout ${i}\n`);
        mockChild.stderr.write(`stderr ${i}\n`);
        if (i % 50 === 0) await new Promise(r => setTimeout(r, 0));
      }
      mockChild.stdout.end();
      mockChild.stderr.end();
    })();

    for await (const evt of stream) {
      events.push(evt);
    }
    
    await streamingPromise;

    const stdoutEvents = events.filter(e => e.eventType === "stdout");
    const stderrEvents = events.filter(e => e.eventType === "stderr");
    
    expect(stdoutEvents.length).toBe(500);
    expect(stderrEvents.length).toBe(500);
    
    // Check monotonic unique sequence numbers
    const seqs = events.map(e => e.sequenceNumber);
    const uniqueSeqs = new Set(seqs);
    expect(uniqueSeqs.size).toBe(events.length);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }

    const terminalEvent = events[events.length - 1];
    expect(terminalEvent?.eventType).toBe("run_completed");
  }, 10000);
});
