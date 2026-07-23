import { describe, expect, it } from "vitest";
import { runBoundedVerifier } from "../src/bounded-verifier.js";

const node = `"${process.execPath}"`;

describe("bounded asynchronous verifier", () => {
  it("captures successful and failing exits", async () => {
    const passed = await runBoundedVerifier(`${node} -e "process.stdout.write('ok')"`, process.cwd());
    const failed = await runBoundedVerifier(`${node} -e "process.stderr.write('bad');process.exit(7)"`, process.cwd());
    expect(passed).toMatchObject({ success: true, exitCode: 0, timedOut: false, stdoutExcerpt: "ok" });
    expect(failed).toMatchObject({ success: false, exitCode: 7, timedOut: false, stderrExcerpt: "bad" });
  });

  it("times out and terminates a long-running verifier", async () => {
    const result = await runBoundedVerifier(
      `${node} -e "setInterval(()=>{},1000)"`,
      process.cwd(),
      { timeoutMs: 100 },
    );
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it("hashes full streams while retaining bounded final excerpts", async () => {
    const result = await runBoundedVerifier(
      `${node} -e "process.stdout.write('A'.repeat(4096)+'TAIL');process.stderr.write('B'.repeat(4096)+'ERRTAIL')"`,
      process.cwd(),
      { maximumStdoutBytes: 64, maximumStderrBytes: 64, excerptBytes: 16 },
    );
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(result.stdoutExcerpt.endsWith("TAIL")).toBe(true);
    expect(result.stderrExcerpt.endsWith("ERRTAIL")).toBe(true);
    expect(result.stdoutExcerpt.length).toBeLessThanOrEqual(16);
    expect(result.stderrExcerpt.length).toBeLessThanOrEqual(16);
    expect(result.stdoutHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.stderrHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("reports launch errors without throwing or hanging", async () => {
    const result = await runBoundedVerifier(`${node} -e "process.exit(0)"`, `${process.cwd()}-does-not-exist`, { timeoutMs: 2_000 });
    expect(result.success).toBe(false);
    expect(result.launchError).toBeTruthy();
  });});
