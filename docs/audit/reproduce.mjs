import { parseOpenCodeStream, priceProviderUsage } from "../../scripts/provider-evidence.mjs";
/** Offline reproductions for the 2026-10-12 repository audit. No provider calls. */
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { RepositoryContextSessionService, ContextEngine } from "../../packages/context-engine/dist/index.js";
import { openDatabase, RepositoryRepository, CodexExecutionRepository, RunRepository } from "../../packages/database/dist/index.js";
import { resolveSnapshotIdentity, extractDirtyPaths, getPorcelainStatus } from "../../packages/git-analyzer/dist/index.js";
import { CodexComparisonService } from "../../packages/codex-app-server/dist/index.js";
import { CharacterRatioTokenEstimator, redactString, DEFAULT_CONFIG } from "../../packages/shared/dist/index.js";
import { orchestrateRun, runTestCommand } from "../../packages/agent-core/dist/index.js";
import { verifyPhase6Task } from "../../scripts/phase6-verifier.mjs";
import { verifyPhase6HiddenTask } from "../../scripts/phase6-hidden-verifier.mjs";
import { deriveRunOutcome } from "../../scripts/phase6-outcome.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(root, "apps/cli/dist/main.js");
const scratch = await mkdtemp(join(tmpdir(), "continuum-audit-"));
const results = {};
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
const command = (cwd, ...args) => execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
try {
  const repo = join(scratch, "repo");
  await cp(join(root, "packages/context-engine/benchmarks/v1/repositories/small-ts"), repo, { recursive: true });
  for (const args of [["init"], ["config", "user.name", "Audit"], ["config", "user.email", "audit@example.test"], ["add", "."], ["commit", "-m", "fixture"]]) git(repo, ...args);
  command(repo, "init", "--non-interactive");
  command(repo, "index");
  const service = await RepositoryContextSessionService.open(repo);
  try {
    const started = await service.start({ task: "Fix refreshToken validation", createInitialContext: true });
    const handoff = await service.handoff(started.session.id);
    const report = await service.report(started.session.id);
    const estimator = new CharacterRatioTokenEstimator();
    results.budget = {
      deliveredItemEstimate: report.budget.deliveredEstimatedTokens,
      handoffLayerEstimate: handoff.budget.estimatedTokens,
      fullHandoffEstimate: estimator.estimate(handoff.prompt),
      initialProfileCeiling: 1500,
    };
    try { await service.start({task:"Fix refreshToken validation",maximumEstimatedTokens:1,createInitialContext:true}); results.tinyBudget={accepted:true}; }
    catch(error){results.tinyBudget={accepted:false,error:error.message};}
    await writeFile(join(repo, "src/auth-service.ts"), (await readFile(join(repo, "src/auth-service.ts"), "utf8")).replace("-refreshed","-updated"));
    const dirtyPaths = extractDirtyPaths(await getPorcelainStatus(repo));
    results.dirtyAttribution = { expectedPath: "src/auth-service.ts", parsedPaths: [...dirtyPaths], detectsDirtySource: dirtyPaths.has("src/auth-service.ts") };
    try {
      await service.request(started.session.id, { query: "Show refreshToken tests" });
      results.afterEditRequest = { accepted: true };
    } catch (error) {
      results.afterEditRequest = { accepted: false, error: error.message };
    }
    const db = openDatabase(join(repo, ".continuum/continuum.db"));
    try {
      const repository = new RepositoryRepository(db).findByPath(repo);
      const engine = new ContextEngine(db, repository.id, await resolveSnapshotIdentity(repo));
      const empty = engine.coverageFor(engine.analyze("Fix refreshToken validation"), []);
      results.emptyCoverage = { complete: empty.complete, missing: empty.missing, evidence: empty.coverageEvidence.map(x => ({ category: x.category, state: x.state })) };
      const staleSearch = await engine.search("refreshToken");
      results.staleSearch = { returnedItems: staleSearch.length, returnedOldContent: staleSearch.some(x => x.item.symbol_name?.includes("refreshToken") && !x.item.content.includes("-updated")) };
      const runId = crypto.randomUUID(), executionId = crypto.randomUUID();
      new RunRepository(db).create({ id: runId, repositoryId: repository.id, agentId: "audit-fixture", task: "audit", startingCommit: started.session.snapshot.base_commit_hash });
      const executions = new CodexExecutionRepository(db);
      executions.create({ id: executionId, session_id: started.session.id, repository_id: repository.id, run_id: runId, task_text: "audit", codex_version: "fixture", model: "fixture", mode: "shadow", approval_configuration: "never", sandbox_configuration: "read-only", base_commit_hash: started.session.snapshot.base_commit_hash, worktree_hash: started.session.snapshot.worktree_hash });
      const sentinel = "Authorization: Bearer AUDIT_REDACTION_SENTINEL_ONLY";
      executions.recordReceived({ raw: { execution_id: executionId, direction: "server_to_client", message_category: "notification", method: "audit/fixture", request_id: null, thread_id: null, turn_id: null, item_id: null, timestamp: new Date().toISOString(), raw_json: JSON.stringify({ output: sentinel }) } });
      results.rawStorage = { sharedRedactorWouldRemoveSentinel: !redactString(sentinel).includes("AUDIT_REDACTION_SENTINEL_ONLY"), sentinelPersistedUnchanged: executions.listRaw(executionId)[0].raw_json.includes(sentinel) };
      try {
        const failed = await orchestrateRun({ task: "AUDIT_THROWING_ADAPTER", adapter: { id: "audit-throws", async *run() { throw new Error("AUDIT_ADAPTER_ERROR"); } }, config: DEFAULT_CONFIG, db, repositoryPath: repo, runsDir: join(repo, ".continuum/runs"), skipBaselineTests: true, skipFinalTests: true });
        results.adapterException={persistedStatus:db.prepare("SELECT status FROM agent_runs WHERE id=?").get(failed.runId).status};
      } catch (error) {
        results.adapterException = { error: error.message, persistedStatus: db.prepare("SELECT status FROM agent_runs WHERE task='AUDIT_THROWING_ADAPTER'").get().status };
      }
    } finally { db.close(); }
  } finally { service.close(); }
  git(repo,"add",".");git(repo,"commit","-m","audit snapshot");command(repo,"index");
  try {
    await new CodexComparisonService().runComparison({ cwd: repo, task: "audit", verifierCommand: `"${process.execPath}" --version`, process: { executable:process.execPath,executableArgs:[join(root,"packages/codex-app-server/tests/fixtures/fake-app-server.mjs")] } });
    results.compare = { accepted: true };
  } catch (error) { results.compare = { accepted: false, error: error.message }; }

  const forged = join(scratch, "forged");
  await mkdir(join(forged, "src"), { recursive: true });
  await mkdir(join(forged, "tests"));
  await writeFile(join(forged, "src/cache.ts"), 'export function readCache(key: string) { return "WRONG_STALE_VALUE"; }\n// timeout\n// key === "timeout"; undefined\n');
  await writeFile(join(forged, "tests/cache.test.ts"), '// cacheTimeoutTest; readCache("timeout"); undefined\nexport function cacheTimeoutTest() { return false; }\n');
  const validation = await verifyPhase6Task({ repository: forged, task: { id: "small-local-cache-timeout", requiredPaths: ["src/cache.ts", "tests/cache.test.ts"] }, status: " M src/cache.ts\n M tests/cache.test.ts\n" });
  const hidden = await verifyPhase6HiddenTask({ repository: forged, taskId: "small-local-cache-timeout" });
  results.forgedPatch = {
    visible: validation.status, hidden: hidden.status,
    wrongImplementation: "readCache always returns WRONG_STALE_VALUE",
    outcome: deriveRunOutcome({ agent: { exitCode: 0, status: "completed" }, git: { changed: true, diffCheckExitCode: 0 }, validation, hiddenValidation: hidden }),
  };
  const reportInput = join(scratch, "report-input.json"), reportOutput = join(scratch, "report");
  const manifest = { taskId: "fixture", agent: "fixture", model: "fixture", repetition: 1 };
  const result = treatment => ({ schemaVersion: "continuum.agent-effectiveness-run.v2", manifest: { ...manifest, treatment }, agent: { usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 }, cost: null, durationMs: 1, status: "completed", exitCode: 0 }, outcome: { patchValidated: true, agentFinishedWithinTimeout: true, verifiedTaskSuccess: true }, validation: { status: "passed" }, hiddenValidation: { status: "passed" } });
  await writeFile(reportInput, JSON.stringify({ completed: ["continuum_off", "continuum_preflight_only"].map(treatment => ({ status: "completed", result: result(treatment) })) }));
  execFileSync(process.execPath, [join(root, "scripts/phase6-report.mjs"), "--input", reportInput, "--output", reportOutput], { stdio: "pipe" });
  const aggregated = JSON.parse(await readFile(reportOutput + ".json", "utf8"));
  results.unpricedReport = { inputCost: null, reportedCost: aggregated.overall.continuum_off.cost, costPerVerifiedSuccess: aggregated.overall.continuum_off.costPerVerifiedSuccess, preflightOnlyPairedRuns: aggregated.preflightOnlyPairedRuns, unpairedRuns: aggregated.unpairedRuns, hasPurePreflightComparison: Array.isArray(aggregated.preflightOnlyPairedByModel) };
  const twoTurns = [100, 200].map(input => JSON.stringify({ type: "step_finish", part: { tokens: { input, output: 10, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.01 } })).join("\n");
  results.openCodeUsage = {expectedPerStepInputSum:300,parsedInputTokens:parseOpenCodeStream(twoTurns).usage.inputTokens};
  results.emptyPricingProfile=priceProviderUsage(parseOpenCodeStream(twoTurns).usage,{}, {provider:"fixture",model:"fixture",observedAt:new Date().toISOString()});
  const fakeTest = join(scratch, "fake-test.mjs");
  await writeFile(fakeTest, 'console.log("Test Files 2 passed (2)\\nTests 10 passed (10)");\n');
  const testResult = await runTestCommand({ command: `"${process.execPath}" "${fakeTest}"`, workingDirectory: scratch, phase: "baseline" });
  results.testCounts = { expectedPassedTests: 10, reportedPassedCount: testResult.passedCount, confidence: testResult.parseConfidence };
  console.log(JSON.stringify(results, null, 2));
} finally { await rm(scratch, { recursive: true, force: true }); }
