/**
 * Test command executor.
 *
 * Runs shell commands as child processes and captures all output.
 * Writes stdout/stderr to files under .continuum/runs/<runId>/ when
 * a runsDir is provided.
 *
 * Design rules:
 * - Never interpret test counts unless the output format is well-known.
 * - Report only the exit code when parsing is not reliable.
 * - Support timeout and cancellation.
 */

import { execa } from "execa";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { now, createLogger } from "@continuum/shared";
import type { TestPhase } from "@continuum/shared";

const log = createLogger("test-executor");

export interface TestCommandResult {
  command: string;
  workingDirectory: string;
  phase: TestPhase;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  stdoutPath?: string;
  stderrPath?: string;
  /** Parsed counts when extraction was reliable. */
  passedCount?: number;
  failedCount?: number;
  /** Confidence in the parsed counts. */
  parseConfidence: "high" | "low" | "unknown";
}

/** Attempt to parse vitest/jest/mocha-style output for pass/fail counts. */
function extractTestCounts(output: string): {
  passed?: number;
  failed?: number;
  confidence: "high" | "low" | "unknown";
} {
  // Vitest format: "X passed" / "X failed"
  const vitestPassed = output.match(/(\d+)\s+passed/i);
  const vitestFailed = output.match(/(\d+)\s+failed/i);

  if (vitestPassed || vitestFailed) {
    return {
      passed: vitestPassed ? parseInt(vitestPassed[1] ?? "0", 10) : undefined,
      failed: vitestFailed ? parseInt(vitestFailed[1] ?? "0", 10) : undefined,
      confidence: "high",
    };
  }

  // Jest format: "Tests: X failed, Y passed"
  const jestMatch = output.match(/Tests:\s*(.*)/i);
  if (jestMatch?.[1]) {
    const passedInJest = jestMatch[1].match(/(\d+)\s+passed/i);
    const failedInJest = jestMatch[1].match(/(\d+)\s+failed/i);
    if (passedInJest || failedInJest) {
      return {
        passed: passedInJest
          ? parseInt(passedInJest[1] ?? "0", 10)
          : undefined,
        failed: failedInJest
          ? parseInt(failedInJest[1] ?? "0", 10)
          : undefined,
        confidence: "high",
      };
    }
  }

  return { confidence: "unknown" };
}

export interface RunTestOptions {
  command: string;
  workingDirectory: string;
  phase: TestPhase;
  timeoutMs?: number;
  signal?: AbortSignal;
  runsDir?: string;
  runId?: string;
}

export async function runTestCommand(
  opts: RunTestOptions,
): Promise<TestCommandResult> {
  const startedAt = now();
  const startMs = Date.now();

  log.info("Running test command", {
    command: opts.command,
    phase: opts.phase,
    cwd: opts.workingDirectory,
  });

  let stdout = "";
  let stderr: string;
  let timedOut = false;
  let cancelled = false;
  let exitCode: number;

  try {
    const result = await execa(opts.command, {
      shell: true,
      cwd: opts.workingDirectory,
      reject: false,
      timeout: opts.timeoutMs,
      cancelSignal: opts.signal as AbortSignal | undefined,
      all: false,
    });

    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";
    exitCode = result.exitCode ?? 0;
    timedOut = result.timedOut ?? false;
    cancelled = result.isCanceled ?? false;
  } catch (err) {
    stderr = err instanceof Error ? err.message : String(err);
    exitCode = 1;
  }

  const finishedAt = now();
  const durationMs = Date.now() - startMs;

  // Save output to files when a runs directory is provided
  let stdoutPath: string | undefined;
  let stderrPath: string | undefined;

  if (opts.runsDir && opts.runId) {
    const phaseDir = join(opts.runsDir, opts.runId, opts.phase);
    await mkdir(phaseDir, { recursive: true });
    stdoutPath = join(phaseDir, "stdout.txt");
    stderrPath = join(phaseDir, "stderr.txt");
    await writeFile(stdoutPath, stdout, "utf-8");
    await writeFile(stderrPath, stderr, "utf-8");
  }

  const combined = stdout + "\n" + stderr;
  const { passed, failed, confidence } = extractTestCounts(combined);

  log.info("Test command finished", {
    exitCode,
    durationMs,
    passedCount: passed,
    failedCount: failed,
    parseConfidence: confidence,
  });

  return {
    command: opts.command,
    workingDirectory: opts.workingDirectory,
    phase: opts.phase,
    startedAt,
    finishedAt,
    durationMs,
    exitCode,
    stdout,
    stderr,
    timedOut,
    cancelled,
    stdoutPath,
    stderrPath,
    passedCount: passed,
    failedCount: failed,
    parseConfidence: confidence,
  };
}
