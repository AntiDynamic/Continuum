import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeAndRunProductionIndex, INDEX_STRATEGY_VERSION } from "@continuum/repository-indexer";
import { serializeCanonical } from "./assist-context-envelope.js";
import { CodexExecutionService, type CodexShadowOptions, openCodexDatabase } from "./execution-service.js";
import { CodexAssistExecutionService } from "./assist-execution-service.js";
import { buildAssistFlightRecorderReport } from "./assist-report.js";
import { buildShadowReport } from "./report.js";
import { runBoundedVerifier, type BoundedVerifierResult } from "./bounded-verifier.js";

export const SHADOW_ASSIST_COMPARISON_SCHEMA_VERSION =
  "continuum.shadow-assist-comparison.v1" as const;

export interface CodexCompareOptions extends Omit<CodexShadowOptions, "mode"> {
  verifierCommand: string;
  verifierTimeoutMs?: number;
}

export interface ComparisonArtifact {
  schema: string;
  sha256: string;
  report: unknown;
}

export interface ShadowAssistComparisonReport {
  schemaVersion: typeof SHADOW_ASSIST_COMPARISON_SCHEMA_VERSION;
  pairId: string;
  taskHash: string;
  baseCommit: string;
  gitTreeHash: string;
  indexStrategyVersion: string;
  model: string | null;
  approvalPolicy: string;
  sandbox: string;
  timeoutMs: number;
  verifier: string;
  comparability: {
    sameBaseCommit: boolean;
    sameTreeHash: boolean;
    sameTask: boolean;
    sameModel: boolean;
    sameApprovalPolicy: boolean;
    sameSandbox: boolean;
    sameTimeout: boolean;
    sameVerifier: boolean;
    valid: boolean;
    invalidReasons: string[];
  };
  shadowArtifact: ComparisonArtifact;
  assistArtifact: ComparisonArtifact;
  verifierResults: { shadow: BoundedVerifierResult; assist: BoundedVerifierResult };
  providerUsage: { shadow: unknown | null; assist: unknown | null };
  measuredDeltas: {
    description: "Measured difference in this matched pair";
    providerInputTokens: number | null;
    providerOutputTokens: number | null;
    durationMs: number | null;
    causalSavingsEstablished: false;
  };
  assistContextMetrics: unknown | null;
  outcome: "both_passed" | "both_failed" | "improvement" | "regression";
  warnings: string[];
}

export interface CodexComparisonResult {
  id: string;
  shadowExecutionId: string;
  assistExecutionId: string;
  shadowVerifierSuccess: boolean;
  assistVerifierSuccess: boolean;
  report: ShadowAssistComparisonReport;
  reportHash: string;
}

export interface ComparisonWorkspace {
  source: string;
  commit: string;
  treeHash: string;
  shadowWorktreePath: string;
  assistWorktreePath: string;
  shadowDatabasePath: string;
  assistDatabasePath: string;
  cleanup(): void;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
function artifact(report: unknown): ComparisonArtifact {
  const serialized = serializeCanonical(report);
  const schema =
    typeof report === "object" && report !== null && "schemaVersion" in report
      ? String((report as { schemaVersion: unknown }).schemaVersion)
      : "unknown";
  return { schema, sha256: sha256(serialized), report };
}

function usageValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : null;
}

function numericDelta(left: unknown, right: unknown): number | null {
  return typeof left === "number" && typeof right === "number" ? right - left : null;
}

export class CodexComparisonService {
  async prepareComparison(cwd: string, repository?: string): Promise<ComparisonWorkspace> {
    const controller = await openCodexDatabase(cwd, repository);
    const source = controller.root;
    controller.db.close();
    const commit = git(source, ["rev-parse", "HEAD"]);
    const treeHash = git(source, ["rev-parse", `${commit}^{tree}`]);
    const shadowWorktreePath = mkdtempSync(join(tmpdir(), "continuum-shadow-"));
    const assistWorktreePath = mkdtempSync(join(tmpdir(), "continuum-assist-"));
    try {
      execFileSync("git", ["worktree", "add", "--detach", shadowWorktreePath, commit], {
        cwd: source, stdio: "ignore", windowsHide: true,
      });
      execFileSync("git", ["worktree", "add", "--detach", assistWorktreePath, commit], {
        cwd: source, stdio: "ignore", windowsHide: true,
      });
      const shadowIndex = await initializeAndRunProductionIndex(shadowWorktreePath, { repositoryId: 1001 });
      const assistIndex = await initializeAndRunProductionIndex(assistWorktreePath, { repositoryId: 1002 });
      if (shadowIndex.repositoryId === assistIndex.repositoryId) {
        throw new Error("Comparison repository database IDs are not independent.");
      }
      if (shadowIndex.databasePath === assistIndex.databasePath) {
        throw new Error("Comparison databases are not independent.");
      }
      if (shadowIndex.baseCommitHash !== commit || assistIndex.baseCommitHash !== commit) {
        throw new Error("Fresh comparison index snapshot does not match the selected commit.");
      }
      return {
        source, commit, treeHash, shadowWorktreePath, assistWorktreePath,
        shadowDatabasePath: shadowIndex.databasePath, assistDatabasePath: assistIndex.databasePath,
        cleanup: () => {
          for (const path of [shadowWorktreePath, assistWorktreePath]) {
            try {
              execFileSync("git", ["worktree", "remove", "--force", path], {
                cwd: source, stdio: "ignore", windowsHide: true,
              });
            } catch {
              try { rmSync(path, { recursive: true, force: true }); } catch {}
            }
          }
        },
      };
    } catch (error) {
      for (const path of [shadowWorktreePath, assistWorktreePath]) {
        try { rmSync(path, { recursive: true, force: true }); } catch {}
      }
      throw error;
    }
  }

  async runComparison(options: CodexCompareOptions): Promise<CodexComparisonResult> {
    const workspace = await this.prepareComparison(options.cwd, options.repository);
    try {
      const shadow = await new CodexExecutionService().runShadow({
        ...options, cwd: workspace.shadowWorktreePath, mode: "shadow",
      });
      const shadowVerifier = await runBoundedVerifier(
        options.verifierCommand, workspace.shadowWorktreePath,
        { timeoutMs: options.verifierTimeoutMs ?? 120_000 },
      );
      const assist = await new CodexAssistExecutionService().runAssist({
        ...options, cwd: workspace.assistWorktreePath,
      });
      const assistVerifier = await runBoundedVerifier(
        options.verifierCommand, workspace.assistWorktreePath,
        { timeoutMs: options.verifierTimeoutMs ?? 120_000 },
      );
      const shadowDb = await openCodexDatabase(workspace.shadowWorktreePath);
      const shadowReport = buildShadowReport(shadowDb.db, shadow.executionId, shadowDb.root);
      shadowDb.db.close();
      const assistDb = await openCodexDatabase(workspace.assistWorktreePath);
      const assistReport = buildAssistFlightRecorderReport(assistDb.db, assist.executionId, assistDb.root, { command: options.verifierCommand, result: assistVerifier });
      assistDb.db.close();

      const id = crypto.randomUUID();
      const shadowArtifact = artifact(shadowReport);
      const assistArtifact = artifact(assistReport);
      const outcome =
        shadowVerifier.success === assistVerifier.success
          ? shadowVerifier.success ? "both_passed" : "both_failed"
          : assistVerifier.success ? "improvement" : "regression";
      const comparability = {
        sameBaseCommit: true, sameTreeHash: true, sameTask: true, sameModel: true,
        sameApprovalPolicy: true, sameSandbox: true, sameTimeout: true, sameVerifier: true,
        valid: true, invalidReasons: [] as string[],
      };
      const shadowUsage = shadowReport.usage.accumulated;
      const assistUsage = assistReport.usage.accumulated;
      const report: ShadowAssistComparisonReport = {
        schemaVersion: SHADOW_ASSIST_COMPARISON_SCHEMA_VERSION,
        pairId: id,
        taskHash: sha256(options.task),
        baseCommit: workspace.commit,
        gitTreeHash: workspace.treeHash,
        indexStrategyVersion: INDEX_STRATEGY_VERSION,
        model: options.model ?? null,
        approvalPolicy: options.approvalPolicy ?? "on-request",
        sandbox: options.sandbox ?? "workspace-write",
        timeoutMs: options.timeoutMs ?? 300_000,
        verifier: options.verifierCommand,
        comparability,
        shadowArtifact,
        assistArtifact,
        verifierResults: { shadow: shadowVerifier, assist: assistVerifier },
        providerUsage: { shadow: shadowUsage ?? null, assist: assistUsage ?? null },
        measuredDeltas: {
          description: "Measured difference in this matched pair",
          providerInputTokens: numericDelta(usageValue(shadowUsage, "inputTokens"), usageValue(assistUsage, "inputTokens")),
          providerOutputTokens: numericDelta(usageValue(shadowUsage, "outputTokens"), usageValue(assistUsage, "outputTokens")),
          durationMs: numericDelta(shadowReport.execution.durationMs, assistReport.execution.durationMs),
          causalSavingsEstablished: false,
        },
        assistContextMetrics: "nativeToolActivity" in assistReport
          ? (assistReport as { nativeToolActivity: unknown }).nativeToolActivity : null,
        outcome,
        warnings: [
          "Continuum context token values are estimates.",
          "Normal repository access remained enabled.",
          "Activity evidence is not complete model-visible context.",
          "A single matched pair does not establish causal savings.",
        ],
      };
      const canonicalReport = serializeCanonical(report);
      const reportHash = sha256(canonicalReport);
      const controller = await openCodexDatabase(options.cwd, options.repository);
      try {
        const repository = controller.db.prepare(
          "SELECT id FROM repositories WHERE canonical_path=?",
        ).get(controller.root) as { id: number } | undefined;
        if (!repository) throw new Error("Comparison source repository is not indexed.");
        const createdAt = new Date().toISOString();
        controller.db.prepare(`
          INSERT INTO codex_comparison_runs(
            id,repository_id,task_text,shadow_execution_id,assist_execution_id,verifier_command,
            shadow_exit_code,assist_exit_code,shadow_stdout_path,shadow_stderr_path,
            assist_stdout_path,assist_stderr_path,outcome,created_at,report_schema_version,
            report_json,report_sha256,task_hash,base_commit_hash,git_tree_hash,model,
            approval_policy,sandbox,timeout_ms,verifier_evidence_json,comparability_json,
            measured_deltas_json,completed_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          id, repository.id, options.task, null, null, options.verifierCommand,
          shadowVerifier.exitCode, assistVerifier.exitCode, null, null, null, null,
          outcome, createdAt, report.schemaVersion, canonicalReport, reportHash,
          report.taskHash, report.baseCommit, report.gitTreeHash, report.model,
          report.approvalPolicy, report.sandbox, report.timeoutMs,
          serializeCanonical(report.verifierResults), serializeCanonical(report.comparability),
          serializeCanonical(report.measuredDeltas), createdAt,
        );
        for (const entry of [
          { mode: "shadow", executionId: shadow.executionId, value: shadowArtifact },
          { mode: "assist", executionId: assist.executionId, value: assistArtifact },
        ] as const) {
          controller.db.prepare(`
            INSERT INTO codex_comparison_artifacts(
              comparison_id,mode,execution_id,report_schema_version,report_json,created_at,report_sha256
            ) VALUES(?,?,?,?,?,?,?)
          `).run(
            id, entry.mode, entry.executionId, entry.value.schema,
            serializeCanonical(entry.value.report), createdAt, entry.value.sha256,
          );
        }
      } finally {
        controller.db.close();
      }
      return {
        id, shadowExecutionId: shadow.executionId, assistExecutionId: assist.executionId,
        shadowVerifierSuccess: shadowVerifier.success,
        assistVerifierSuccess: assistVerifier.success, report, reportHash,
      };
    } finally {
      workspace.cleanup();
    }
  }

  async comparisonReport(
    cwd: string, pairId: string, repository?: string,
  ): Promise<ShadowAssistComparisonReport> {
    const controller = await openCodexDatabase(cwd, repository);
    try {
      const row = controller.db.prepare(
        "SELECT report_json,report_sha256 FROM codex_comparison_runs WHERE id=?",
      ).get(pairId) as { report_json: string | null; report_sha256: string | null } | undefined;
      if (!row?.report_json || !row.report_sha256) {
        throw new Error(`Comparison pair not found: ${pairId}`);
      }
      if (sha256(row.report_json) !== row.report_sha256) {
        throw new Error(`Comparison report hash mismatch: ${pairId}`);
      }
      return JSON.parse(row.report_json) as ShadowAssistComparisonReport;
    } finally {
      controller.db.close();
    }
  }
}
