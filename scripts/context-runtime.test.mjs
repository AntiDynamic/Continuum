import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { RepositoryContextSessionService } from "../packages/context-engine/dist/index.js";
import { openDatabase, ContextRepository, CodexExecutionRepository, RunRepository } from "../packages/database/dist/index.js";
import { CharacterRatioTokenEstimator, DEFAULT_CONFIG } from "../packages/shared/dist/index.js";
import { getPorcelainStatus, extractDirtyPaths } from "../packages/git-analyzer/dist/index.js";
import { orchestrateRun, runTestCommand } from "../packages/agent-core/dist/index.js";
import { CodexComparisonService, CodexExecutionService } from "../packages/codex-app-server/dist/index.js";
const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),cli=join(root,"apps/cli/dist/main.js");
const git=(cwd,...args)=>execFileSync("git",args,{cwd,stdio:"pipe"});
const command=(cwd,...args)=>execFileSync(process.execPath,[cli,...args],{cwd,stdio:"pipe"});
async function fixture() {
  const directory=await mkdtemp(join(tmpdir(),"continuum-runtime-test-"));
  await cp(join(root,"packages/context-engine/benchmarks/v1/repositories/small-ts"),directory,{recursive:true});
  for(const args of [["init"],["config","user.name","Test"],["config","user.email","test@example.test"],["add","."],["commit","-m","fixture"]])git(directory,...args);
  command(directory,"init","--non-interactive");command(directory,"index");
  return directory;
}
test("delivery budget, restart receipts, edit refresh and compaction restoration",async()=>{
  const repo=await fixture();let service=await RepositoryContextSessionService.open(repo);
  try {
    const started=await service.start({task:"Fix refreshToken validation",createInitialContext:true});
    const id=started.session.id,initial=started.initialContext,handoff=await service.handoff(id);
    assert.equal(handoff.prompt,initial.renderedContent);
    assert.equal(handoff.budget.estimatedTokens,new CharacterRatioTokenEstimator().estimate(handoff.prompt));
    assert.ok(handoff.budget.estimatedTokens<=1500);
    service.close();service=await RepositoryContextSessionService.open(repo);
    assert.deepEqual(await service.initialContext(id),JSON.parse(JSON.stringify(initial)));
    await assert.rejects(service.start({task:"Fix refreshToken",maximumEstimatedTokens:1,createInitialContext:true}),/budget/i);
    const db=openDatabase(join(repo,".continuum/continuum.db"));
    const repository=db.prepare("SELECT id FROM repositories").get();
    const versions=new ContextRepository(db),before=versions.listCurrentVersions(repository.id).filter(x=>x.source_path==="src/cache.ts").map(x=>x.id);
    await writeFile(join(repo,"src/auth-service.ts"),(await readFile(join(repo,"src/auth-service.ts"),"utf8")).replace('"-refreshed"','"-updated"'));
    assert.ok(extractDirtyPaths(await getPorcelainStatus(repo)).has("src/auth-service.ts"));
    const delta=await service.request(id,{query:"AuthService.refreshToken",requestedSymbols:["AuthService.refreshToken"]});
    assert.ok(delta.renderedContent.includes("updated"));
    assert.deepEqual(versions.listCurrentVersions(repository.id).filter(x=>x.source_path==="src/cache.ts").map(x=>x.id),before);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM context_session_epochs WHERE session_id=?").get(id).n,1);
    await service.checkpoint(id);
    const restored=await service.request(id,{query:"AuthService.refreshToken",requestedSymbols:["AuthService.refreshToken"]});
    assert.ok(restored.restoredItems.length>0);assert.ok(restored.renderedContent.includes("updated"));
    const rows=db.prepare("SELECT rendered_estimated_tokens,rendered_hash FROM context_session_deliveries WHERE session_id=?").all(id);
    assert.ok(rows.every(x=>x.rendered_hash));
    assert.equal((await service.report(id)).budget.deliveredEstimatedTokens,rows.reduce((sum,x)=>sum+x.rendered_estimated_tokens,0));
    db.close();
  } finally {service.close();await rm(repo,{recursive:true,force:true});}
});

test("adapter exception closes its run; logs count tests and redact before persistence",async()=>{
  const repo=await fixture(),db=openDatabase(join(repo,".continuum/continuum.db"));
  try {
    const result=await orchestrateRun({task:"throwing adapter",adapter:{id:"fixture",async *run(){throw new Error("failure");}},config:DEFAULT_CONFIG,db,repositoryPath:repo,runsDir:join(repo,".continuum/runs"),skipBaselineTests:true,skipFinalTests:true});
    assert.equal(result.status,"failed");assert.equal(db.prepare("SELECT status FROM agent_runs WHERE id=?").get(result.runId).status,"failed");
    const script=join(repo,"emit.cjs");await writeFile(script,'console.log("Test Files 2 passed (2)\\nTests 10 passed (10)\\nAuthorization: Bearer FAKE_SENTINEL_ONLY");');
    const logged=await runTestCommand({command:`"${process.execPath}" "${script}"`,workingDirectory:repo,phase:"final",runsDir:join(repo,".continuum/runs"),runId:result.runId});
    assert.equal(logged.passedCount,10);assert.ok(!(await readFile(logged.stdoutPath,"utf8")).includes("FAKE_SENTINEL_ONLY"));
  } finally {db.close();await rm(repo,{recursive:true,force:true});}
});

test("Codex raw storage redacts built-in/custom patterns and honors capture-disabled",async()=>{
  const repo=await fixture(),service=await RepositoryContextSessionService.open(repo),db=openDatabase(join(repo,".continuum/continuum.db"));
  try {
    const session=(await service.start({task:"Inspect cache"})).session,repository=db.prepare("SELECT id FROM repositories").get();
    const runId=crypto.randomUUID();new RunRepository(db).create({id:runId,repositoryId:repository.id,agentId:"fixture",task:"test"});
    const records=new CodexExecutionRepository(db,{redactPatterns:["CUSTOM_SENTINEL"]}),id=crypto.randomUUID();
    records.create({id,session_id:session.id,repository_id:repository.id,run_id:runId,task_text:"test",codex_version:"fixture",model:"fixture",mode:"shadow",approval_configuration:"never",sandbox_configuration:"read-only",base_commit_hash:session.snapshot.base_commit_hash,worktree_hash:session.snapshot.worktree_hash});
    const raw={execution_id:id,direction:"server_to_client",message_category:"notification",method:"test",request_id:null,thread_id:null,turn_id:null,item_id:null,timestamp:new Date().toISOString(),raw_json:JSON.stringify({output:"Authorization: Bearer FAKE_SENTINEL_ONLY CUSTOM_SENTINEL"})};
    records.recordReceived({raw});assert.ok(!JSON.stringify(records.listRaw(id)).includes("SENTINEL"));
    new CodexExecutionRepository(db,{captureRawOutput:false}).recordReceived({raw});assert.ok(records.listRaw(id).at(-1).raw_json.includes("captureDisabled"));
  } finally {db.close();service.close();await rm(repo,{recursive:true,force:true});}
});

test("comparison initializes independent workspaces and retains reports after cleanup",async()=>{
  const repo=await fixture();
  try {
    git(repo,"add",".");git(repo,"commit","-m","initialize fixture");command(repo,"index");
    const before=git(repo,"status","--porcelain").toString();
    const result=await new CodexComparisonService().runComparison({cwd:repo,task:"Inspect cache",verifierCommand:`"${process.execPath}" --version`,process:{executable:process.execPath,executableArgs:[join(root,"packages/codex-app-server/tests/fixtures/fake-app-server.mjs")]},order:"assist-first",timeoutMs:10000});
    assert.equal(result.shadowVerifierSuccess,true);assert.equal(result.assistVerifierSuccess,true);
    const report=await new CodexExecutionService().report(repo,result.assistExecutionId);
    assert.equal(report.execution.status,"completed");assert.equal(git(repo,"status","--porcelain").toString(),before);
    await assert.rejects(new CodexComparisonService().runComparison({cwd:repo,task:"Inspect cache",verifierCommand:`"${process.execPath}" --version`,process:{executable:process.execPath,executableArgs:[join(root,"packages/codex-app-server/tests/fixtures/fake-app-server.mjs")],env:{FAKE_CODEX_SCENARIO:"unexpected-exit"}},order:"shadow-first",timeoutMs:10000}));
    const retained=openDatabase(join(repo,".continuum/continuum.db"));
    let failed;
    try {failed=retained.prepare("SELECT execution_id FROM codex_external_reports WHERE json_extract(report_json,'$.execution.status')='failed'").get();}
    finally {retained.close();}
    assert.ok(failed);
    assert.equal((await new CodexExecutionService().report(repo,failed.execution_id)).execution.status,"failed");
    assert.equal(git(repo,"status","--porcelain").toString(),before);
  } finally {await rm(repo,{recursive:true,force:true});}
});
