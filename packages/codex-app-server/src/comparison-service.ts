import { execSync } from "node:child_process";
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

function resetGitState(cwd: string): void {
  execSync("git reset --hard HEAD", { cwd });
  execSync("git clean -fd", { cwd });
}

export class CodexComparisonService {
  async runComparison(options: CodexCompareOptions): Promise<CodexComparisonResult> {
    const shadowService = new CodexExecutionService();
    const assistService = new CodexAssistExecutionService();
    
    // Ensure clean state before starting
    resetGitState(options.cwd);
    
    // 1. Run Shadow
    console.log("[Comparison] Running Shadow (unassisted) execution...");
    const shadowResult = await shadowService.runShadow({ ...options, mode: "shadow" });
    const shadowVerifier = runVerifier(options.verifierCommand, options.cwd);
    
    // Reset state
    console.log("[Comparison] Resetting workspace state...");
    resetGitState(options.cwd);
    
    // 2. Run Assist
    console.log("[Comparison] Running Assist (assisted) execution...");
    const assistResult = await assistService.runAssist(options);
    const assistVerifier = runVerifier(options.verifierCommand, options.cwd);
    
    // Reset state
    resetGitState(options.cwd);
    
    // 3. Persist Comparison
    const comparisonId = crypto.randomUUID();
    const opened = await openCodexDatabase(options.cwd, options.repository);
    try {
      opened.db.prepare(
        `INSERT INTO codex_comparison_runs (id, shadow_execution_id, shadow_verifier_success, shadow_verifier_output, assist_execution_id, assist_verifier_success, assist_verifier_output, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        comparisonId,
        shadowResult.executionId,
        shadowVerifier.success ? 1 : 0,
        shadowVerifier.output,
        assistResult.executionId,
        assistVerifier.success ? 1 : 0,
        assistVerifier.output,
        new Date().toISOString()
      );
    } finally {
      opened.db.close();
    }
    
    return {
      id: comparisonId,
      shadowExecutionId: shadowResult.executionId,
      shadowVerifierSuccess: shadowVerifier.success,
      shadowVerifierOutput: shadowVerifier.output,
      assistExecutionId: assistResult.executionId,
      assistVerifierSuccess: assistVerifier.success,
      assistVerifierOutput: assistVerifier.output
    };
  }
}
