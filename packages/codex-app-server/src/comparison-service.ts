import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutionService, type CodexShadowOptions } from "./execution-service.js";
import { CodexAssistExecutionService } from "./assist-execution-service.js";
import { openCodexDatabase } from "./execution-service.js";

export interface CodexCompareOptions extends Omit<CodexShadowOptions, "mode"> {
  verifierCommand: string;
}

export interface CodexComparisonResult {
  id: string;
  shadowExecutionId: string;
  shadowVerifierSuccess: boolean;
  shadowVerifierOutput: string;
  assistExecutionId: string;
  assistVerifierSuccess: boolean;
  assistVerifierOutput: string;
}

function runVerifier(command: string, cwd: string): { success: boolean; output: string } {
  try {
    const output = execSync(command, { cwd, encoding: "utf8", stdio: "pipe" });
    return { success: true, output };
  } catch (error: any) {
    return { success: false, output: error.stdout ? `${error.stdout}\n${error.stderr}` : error.message };
  }
}

export class CodexComparisonService {
  async runComparison(options: CodexCompareOptions): Promise<CodexComparisonResult> {
    const cwd = options.cwd;
    const worktreePath = mkdtempSync(join(tmpdir(), "continuum-compare-"));

    try {
      // Create isolated worktree detached at current HEAD
      execSync(`git worktree add --detach "${worktreePath}" HEAD`, { cwd, stdio: "ignore" });

      const shadowOptions: CodexShadowOptions = { ...options, cwd: worktreePath, mode: "shadow" };
      const shadowService = new CodexExecutionService();
      const shadowResult = await shadowService.runShadow(shadowOptions);
      const shadowVerifier = runVerifier(options.verifierCommand, worktreePath);

      // Clean worktree for assist run
      execSync(`git reset --hard HEAD`, { cwd: worktreePath, stdio: "ignore" });
      execSync(`git clean -fd`, { cwd: worktreePath, stdio: "ignore" });

      const assistOptions = { ...options, cwd: worktreePath };
      const assistService = new CodexAssistExecutionService();
      const assistResult = await assistService.runAssist(assistOptions);
      const assistVerifier = runVerifier(options.verifierCommand, worktreePath);

      const comparisonId = crypto.randomUUID();
      const outcome = shadowVerifier.success && !assistVerifier.success ? "regression" :
                      !shadowVerifier.success && assistVerifier.success ? "improvement" :
                      shadowVerifier.success && assistVerifier.success ? "both_passed" : "both_failed";

      const opened = await openCodexDatabase(options.cwd, options.repository);
      const repoRow = opened.db.prepare("SELECT id FROM repositories WHERE canonical_path=?").get(opened.root) as { id: number };
      opened.db.prepare(`
        INSERT INTO codex_comparison_runs(
          id, repository_id, task_text, shadow_execution_id, assist_execution_id, verifier_command,
          shadow_exit_code, assist_exit_code, shadow_stdout_path, shadow_stderr_path, assist_stdout_path, assist_stderr_path, outcome, created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        comparisonId,
        repoRow.id,
        options.task,
        shadowResult.executionId,
        assistResult.executionId,
        options.verifierCommand,
        shadowVerifier.success ? 0 : 1,
        assistVerifier.success ? 0 : 1,
        null, null, null, null, // File paths for stdout/err can be null for now
        outcome,
        new Date().toISOString()
      );
      opened.db.close();

      return {
        id: comparisonId,
        shadowExecutionId: shadowResult.executionId,
        shadowVerifierSuccess: shadowVerifier.success,
        shadowVerifierOutput: shadowVerifier.output,
        assistExecutionId: assistResult.executionId,
        assistVerifierSuccess: assistVerifier.success,
        assistVerifierOutput: assistVerifier.output
      };
    } finally {
      try { execSync(`git worktree remove --force "${worktreePath}"`, { cwd, stdio: "ignore" }); } catch {}
      try { rmSync(worktreePath, { recursive: true, force: true }); } catch {}
    }
  }
}
