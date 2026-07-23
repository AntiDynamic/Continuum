import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDatabase, RepositoryRepository } from "@continuum/database";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../dist/main.js");
interface ProcessResult { exitCode: number; stdout: string; stderr: string }
function continuum(cwd: string, args: string[]): Promise<ProcessResult> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (value) => stdout += String(value));
    child.stderr.on("data", (value) => stderr += String(value));
    child.on("error", reject);
    child.on("close", (code) => done({ exitCode: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

describe("codex compare-report", () => {
  let repository: string;
  const pairId = "pair-fixture";
  const report = {
    schemaVersion: "continuum.shadow-assist-comparison.v1",
    pairId,
    taskHash: "task-hash",
    baseCommit: "commit",
    gitTreeHash: "tree",
    indexStrategyVersion: "continuum.production-index.v1",
    model: null,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    timeoutMs: 1000,
    verifier: "test",
    comparability: {
      sameBaseCommit: true, sameTreeHash: true, sameTask: true, sameModel: true,
      sameApprovalPolicy: true, sameSandbox: true, sameTimeout: true, sameVerifier: true,
      valid: true, invalidReasons: [],
    },
    shadowArtifact: { schema: "shadow", sha256: "a", report: {} },
    assistArtifact: { schema: "assist", sha256: "b", report: {} },
    verifierResults: {
      shadow: { success: true }, assist: { success: true },
    },
    providerUsage: { shadow: null, assist: null },
    measuredDeltas: {
      description: "Measured difference in this matched pair",
      providerInputTokens: null, providerOutputTokens: null, durationMs: null,
      causalSavingsEstablished: false,
    },
    assistContextMetrics: null,
    outcome: "both_passed",
    warnings: ["A single matched pair does not establish causal savings."],
  };

  beforeAll(async () => {
    repository = await mkdtemp(join(tmpdir(), "continuum-compare-report-"));
    execFileSync("git", ["init"], { cwd: repository });
    await mkdir(join(repository, ".continuum"));
    await writeFile(join(repository, ".continuum", "config.json"), "{}", "utf8");
    const db = openDatabase(join(repository, ".continuum", "continuum.db"));
    migrate(db);
    const repositoryRow = new RepositoryRepository(db).upsert(repository, "fixture");
    const serialized = JSON.stringify(report);
    const hash = createHash("sha256").update(serialized, "utf8").digest("hex");
    db.prepare(`
      INSERT INTO codex_comparison_runs(
        id,repository_id,task_text,verifier_command,outcome,created_at,
        report_schema_version,report_json,report_sha256
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `).run(
      pairId, repositoryRow.id, "fixture", "test", "both_passed",
      new Date().toISOString(), report.schemaVersion, serialized, hash,
    );
    db.close();
  });

  afterAll(async () => { await rm(repository, { recursive: true, force: true }); });

  it("emits JSON only and returns a clear non-zero error for unknown IDs", async () => {
    const found = await continuum(repository, ["codex", "compare-report", pairId, "--json"]);
    expect(found.exitCode, found.stderr).toBe(0);
    expect(JSON.parse(found.stdout)).toEqual(report);
    const missing = await continuum(repository, ["codex", "compare-report", "missing", "--json"]);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toContain("Comparison pair not found: missing");
    expect(missing.stdout).toBe("");
  });
});
