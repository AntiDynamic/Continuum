import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBehavior } from "./phase6-behavior.mjs";
import { verifyPhase6Task } from "./phase6-verifier.mjs";
import { verifyPhase6HiddenTask } from "./phase6-hidden-verifier.mjs";
import { buildEffectivenessReport } from "./phase6-report-model.mjs";
import { parseOpenCodeStream, priceProviderUsage } from "./provider-evidence.mjs";
import { openCodeMcpConfiguration } from "./host-config.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");

test("wrong implementation with matching comments fails both executable validators",async()=>{
  const repo=await mkdtemp(join(tmpdir(),"continuum-behavior-test-"));
  try {
    await cp(join(root,"packages/context-engine/benchmarks/v1/repositories/small-ts"),repo,{recursive:true});
    await writeFile(join(repo,"src/cache.ts"),'export function readCache(key:string) { return "WRONG_STALE_VALUE"; }\n// key === "timeout"; undefined\n');
    const task={id:"small-local-cache-timeout",requiredPaths:["src/cache.ts","tests/cache.test.ts"]};
    const visible=await verifyPhase6Task({repository:repo,task,status:" M src/cache.ts\n M tests/cache.test.ts\n"});
    assert.equal(visible.status,"failed");
    assert.equal((await verifyPhase6HiddenTask({repository:repo,taskId:task.id})).status,"failed");
    await writeFile(join(repo,"src/cache.ts"),'export function readCache(key:string):string|undefined { return key === "timeout" ? undefined : key; }\nexport function invalidateCache(key:string) { return Boolean(key); }\n');
    assert.equal((await verifyPhase6HiddenTask({repository:repo,taskId:task.id})).status,"passed");
  } finally {await rm(repo,{recursive:true,force:true});}
});

test("migration qualification executes SQL and rejects a data-losing rollback",async()=>{
  const repo=await mkdtemp(join(tmpdir(),"continuum-sql-test-"));
  try {
    await cp(join(root,"packages/context-engine/benchmarks/v1/repositories/sql-docs"),repo,{recursive:true});
    assert.equal((await verifyBehavior({repository:repo,taskId:"sql-migration-refresh",hidden:true})).status,"failed");
    const path=join(repo,"migrations/002_add_refresh_token.sql");
    await writeFile(path,"ALTER TABLE users ADD COLUMN refresh_token_hash TEXT;\nCREATE INDEX users_refresh_hash_idx ON users(refresh_token_hash);\n-- rollback\nDROP INDEX users_refresh_hash_idx;\nALTER TABLE users DROP COLUMN refresh_token_hash;\n");
    assert.equal((await verifyBehavior({repository:repo,taskId:"sql-migration-refresh",hidden:true})).status,"passed");
    await writeFile(path,(await readFile(path,"utf8")).replace("ALTER TABLE users DROP COLUMN refresh_token_hash;","DELETE FROM users;\nALTER TABLE users DROP COLUMN refresh_token_hash;"));
    assert.equal((await verifyBehavior({repository:repo,taskId:"sql-migration-refresh",hidden:true})).status,"failed");
  } finally {await rm(repo,{recursive:true,force:true});}
});

test("default pure-preflight pair is reported and unknown cost stays unknown",()=>{
  const result=treatment=>({schemaVersion:"continuum.agent-effectiveness-run.v2",manifest:{agent:"fixture",model:"fixture",taskId:"bug",repetition:1,treatment},agent:{exitCode:0,status:"completed",durationMs:1,cost:null,usage:{inputTokens:100,outputTokens:10,totalTokens:110}},git:{changed:true,diffCheckExitCode:0},validation:{status:"passed",behavioral:true,scope:{status:"passed"}},hiddenValidation:{status:"passed",behavioral:true}});
  const entries=["continuum_off","continuum_preflight_only"].map(treatment=>({status:"completed",result:result(treatment)}));
  const report=buildEffectivenessReport(entries);
  assert.equal(report.preflightOnlyPairedRuns,1);assert.equal(report.unpairedRuns,0);
  assert.equal(report.preflightOnlyPairedByModel[0].pairs,1);
  assert.equal(report.overall.continuum_off.costPerVerifiedSuccess,null);
  assert.equal(report.overall.continuum_off.cost.measured,0);
  entries[1].result.agent.failureCategory="provider_quota";
  assert.equal(buildEffectivenessReport(entries).preflightOnlyPairedByModel[0].pairs,0);
  delete entries[1].result.agent.failureCategory;
  entries[1].result.hiddenValidation.behavioral=false;
  assert.equal(buildEffectivenessReport(entries).overall.continuum_preflight_only.eligibleRuns,0);
});

test("usage sums per-step events and requires a complete matching price profile",()=>{
  const events=[100,200].map(input=>JSON.stringify({type:"step_finish",part:{cost:0.01,tokens:{input,output:10,reasoning:0,cache:{read:0,write:0}}}})).join("\n");
  const usage=parseOpenCodeStream(events).usage;
  assert.equal(usage.inputTokens,300);assert.equal(usage.totalTokens,null);
  assert.equal(priceProviderUsage(usage,{}, {provider:"fixture",model:"fixture",observedAt:"2026-10-12"}),null);
  const priced=priceProviderUsage({...usage,outputIncludesThinking:true},{id:"v1",version:"v1",provider:"fixture",model:"fixture",currency:"USD",effectiveFrom:"2026-01-01",inputPerMillion:1,outputPerMillion:2},{provider:"fixture",model:"fixture",observedAt:"2026-10-12"});
  assert.equal(priced.measurement,"derived");assert.ok(Math.abs(priced.total-0.00034)<1e-10);
});

test("OpenCode configuration uses direct named servers and preserves other servers",()=>{
  const config=openCodeMcpConfiguration('{"mcp":{"other":{"type":"local","command":["other"]}}}',{enabled:true,command:["node","continuum","mcp"]});
  assert.ok(config.mcp.continuum);assert.ok(config.mcp.other);assert.equal(config.mcp.servers,undefined);assert.equal(config.mcp.continuum.cwd,undefined);
});
