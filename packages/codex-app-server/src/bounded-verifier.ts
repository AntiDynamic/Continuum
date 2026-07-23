import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export interface BoundedVerifierOptions {
  timeoutMs?: number;
  maximumStdoutBytes?: number;
  maximumStderrBytes?: number;
  excerptBytes?: number;
}

export interface BoundedVerifierResult {
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  stdoutHash: string;
  stderrHash: string;
  stdoutExcerpt: string;
  stderrExcerpt: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  launchError: string | null;
  output: string;
}

function appendBounded(current: Buffer, chunk: Buffer, maximum: number) {
  if (current.length >= maximum) return { value: current, truncated: true };
  const remaining = maximum - current.length;
  return { value: Buffer.concat([current, chunk.subarray(0, remaining)]), truncated: chunk.length > remaining };
}
function terminateTree(child: ReturnType<typeof spawn>, force: boolean): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const args = ["/pid", String(child.pid), "/t", ...(force ? ["/f"] : [])];
    spawn("taskkill", args, { windowsHide: true, stdio: "ignore" });
    return;
  }
  try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); }
  catch { child.kill(force ? "SIGKILL" : "SIGTERM"); }
}
function appendTail(current: Buffer, chunk: Buffer, maximum: number): Buffer {
  if (maximum === 0) return Buffer.alloc(0);
  const combined = Buffer.concat([current, chunk]);
  return combined.subarray(Math.max(0, combined.length - maximum));
}

export function runBoundedVerifier(
  command: string,
  cwd: string,
  options: BoundedVerifierOptions = {},
): Promise<BoundedVerifierResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maximumStdoutBytes = options.maximumStdoutBytes ?? 256 * 1024;
  const maximumStderrBytes = options.maximumStderrBytes ?? 256 * 1024;
  const excerptBytes = options.excerptBytes ?? 16 * 1024;
  const started = performance.now();
  return new Promise((resolve) => {
    const stdoutHash = createHash("sha256");
    const stderrHash = createHash("sha256");
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stdoutTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderrTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let launchError: string | null = null;
    const child = spawn(command, { cwd, shell: true, windowsHide: true, detached: process.platform !== "win32" });
    child.stdout?.on("data", (value: Buffer) => {
      stdoutHash.update(value);
      stdoutTail = appendTail(stdoutTail, value, excerptBytes);
      const next = appendBounded(stdout, value, maximumStdoutBytes);
      stdout = next.value;
      stdoutTruncated ||= next.truncated;
    });
    child.stderr?.on("data", (value: Buffer) => {
      stderrHash.update(value);
      stderrTail = appendTail(stderrTail, value, excerptBytes);
      const next = appendBounded(stderr, value, maximumStderrBytes);
      stderr = next.value;
      stderrTruncated ||= next.truncated;
    });
    let escalationTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateTree(child, false);
      escalationTimer = setTimeout(() => terminateTree(child, true), 1_000);
    }, timeoutMs);
    child.on("error", (error) => {
      launchError = error.message;
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (escalationTimer) clearTimeout(escalationTimer);
      resolve({
        success: exitCode === 0 && !timedOut && launchError === null,
        exitCode,
        durationMs: Math.max(0, performance.now() - started),
        timedOut,
        stdoutHash: stdoutHash.digest("hex"),
        stderrHash: stderrHash.digest("hex"),
        stdoutExcerpt: stdoutTail.toString("utf8"),
        stderrExcerpt: stderrTail.toString("utf8"),
        stdoutTruncated,
        stderrTruncated,
        launchError,
        output: `${stdoutTail.toString("utf8")}${stderrTail.toString("utf8")}`,
      });
    });
  });
}
