#!/usr/bin/env node
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "apps/cli/dist/main.js");
const fixture = join(root, "packages/context-engine/benchmarks/v1/repositories/small-ts");
const { RepositoryContextSessionService } = await import(join(root, "packages/context-engine/dist/session/session-service.js"));
const scratch = await mkdtemp(join(tmpdir(), "continuum-phase6-recovery-"));
const repo = join(scratch, "small-ts");
try {
  await cp(fixture, repo, { recursive: true });
  await exec("git", ["init"], { cwd: repo });
  await exec("git", ["config", "user.email", "phase6@continuum.invalid"], { cwd: repo });
  await exec("git", ["config", "user.name", "Continuum Phase 6"], { cwd: repo });
  await exec("git", ["add", "."], { cwd: repo });
  await exec("git", ["commit", "-m", "phase6 recovery smoke"], { cwd: repo });
  await exec(process.execPath, [cli, "init", "--non-interactive"], { cwd: repo });
  await exec(process.execPath, [cli, "index"], { cwd: repo });

  const service = await RepositoryContextSessionService.open(repo);
  try {
    const started = await service.start({ task: "Fix refreshToken validation error with regression test", createInitialContext: true });
    const sessionId = started.session.id;
    const requested = await service.request(sessionId, { query: "AuthService.refreshToken", requestedSymbols: ["AuthService.refreshToken"] });
    await service.signal(sessionId, { type: "test_failure", failingTests: ["tests/auth-service.test.ts"], errorSummary: "refresh token validation failed", relatedSymbols: ["AuthService.refreshToken"] });
    const recovery = await service.recover(sessionId);
    const report = await service.report(sessionId);
    const result = {
      schemaVersion: "continuum.agent-recovery-smoke.v1",
      status: recovery.sessionId === sessionId && recovery.activeContext.length > 0 ? "passed" : "failed",
      sessionId,
      initialContextBytes: Buffer.byteLength(JSON.stringify(started.initialContext ?? {})),
      requestedContextBytes: Buffer.byteLength(JSON.stringify(requested)),
      recoveryPacketBytes: Buffer.byteLength(JSON.stringify(recovery)),
      recoveryPacket: recovery,
      report: { deliveryCount: report.activity.deliveryCount, signalCount: report.activity.signalCount, coverage: report.coverage },
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    service.close();
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
