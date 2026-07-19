import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp,mkdir,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname,join,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openDatabase } from "@continuum/database";
const here=dirname(fileURLToPath(import.meta.url)),cli=resolve(here,"../../../apps/cli/dist/main.js");
interface Result{exitCode:number;stdout:string;stderr:string}
function run(command:string,args:string[],cwd:string):Promise<Result>{return new Promise((done,reject)=>{const child=spawn(command,args,{cwd,env:process.env,windowsHide:true});let stdout="",stderr="";child.stdout.on("data",v=>stdout+=String(v));child.stderr.on("data",v=>stderr+=String(v));child.on("error",reject);child.on("close",code=>done({exitCode:code??-1,stdout:stdout.trim(),stderr:stderr.trim()}));});}
const git=(cwd:string,...args:string[])=>run("git",args,cwd);
const continuum=(cwd:string,...args:string[])=>run(process.execPath,[cli,...args],cwd);
const structured=<T>(value:Awaited<ReturnType<Client["callTool"]>>):T=>value.structuredContent as T;
describe("CLI/MCP progressive context product",()=>{
 let repository:string,client:Client,transport:StdioClientTransport,sessionId:string;
 async function connectMcp(){transport=new StdioClientTransport({command:process.execPath,args:[cli,"mcp"],cwd:repository,stderr:"pipe"});client=new Client({name:"product-test",version:"1.0.0"},{capabilities:{}});await client.connect(transport);}
 async function restartMcp(){await client.close();await connectMcp();}
 beforeAll(async()=>{
  repository=await mkdtemp(join(tmpdir(),"continuum-session-product-"));await git(repository,"init");await git(repository,"config","user.name","Test");await git(repository,"config","user.email","test@example.test");
  await mkdir(join(repository,"src"));await mkdir(join(repository,"tests"));await mkdir(join(repository,"security"));
  await writeFile(join(repository,"src","auth-service.ts"),'export class AuthService { refreshToken(): string { return "trusted"; } }\n');
  await writeFile(join(repository,"src","formatter.ts"),'export class ReportFormatter { renderCsv(): string { return "csv"; } }\n');
  await writeFile(join(repository,"tests","startup-timeout.test.ts"),'export const startupTimeoutTest = "AuthService.refreshToken";\n');
  await writeFile(join(repository,"security","policy.md"),"# Trust policy\nNever weaken token validation.\n");
  await git(repository,"add",".");await git(repository,"commit","-m","fixture");
  expect((await continuum(repository,"init","--non-interactive")).exitCode).toBe(0);
  await writeFile(join(repository,"security","local-policy.md"),"# Local policy\nTimeout changes require tests.\n");
  expect((await continuum(repository,"index")).exitCode).toBe(0);
  await connectMcp();
 },60000);
 afterAll(async()=>{await client?.close();if(repository)await rm(repository,{recursive:true,force:true});});
 it("shares one persisted session through built CLI and actual MCP stdio",async()=>{
  const tools=await client.listTools();expect(tools.tools.map(t=>t.name)).toEqual(expect.arrayContaining(["continuum_start_context_session","continuum_get_context_session","continuum_get_initial_context","continuum_request_context","continuum_report_context_signal","continuum_get_context_session_report","continuum_complete_context_session","continuum_list_context_sessions","retrieve_context"]));
  const start=await continuum(repository,"session","start","Fix authentication timeout without weakening trust validation","--budget-tokens","8000","--json");expect(start.exitCode,start.stderr).toBe(0);
  const started=JSON.parse(start.stdout);sessionId=started.session.id;expect(started.schemaVersion).toBe("continuum.context-session.v1");expect(started.session.snapshot.worktree_hash).toBeTruthy();
  const first=structured<any>(await client.callTool({name:"continuum_get_initial_context",arguments:{sessionId}})),repeated=structured<any>(await client.callTool({name:"continuum_get_initial_context",arguments:{sessionId}}));
  expect(repeated.id).toBe(first.id);expect(repeated.newItems.map((x:any)=>x.candidate.item.id)).toEqual(first.newItems.map((x:any)=>x.candidate.item.id));
  await restartMcp();
  const requestedResult=await continuum(repository,"session","request",sessionId,"ReportFormatter.renderCsv","--symbol","ReportFormatter.renderCsv","--json");expect(requestedResult.exitCode,requestedResult.stderr).toBe(0);
  const requested=JSON.parse(requestedResult.stdout).packet;expect(requested.newItems.length).toBeGreaterThan(0);
  await restartMcp();
  const duplicate=structured<any>(await client.callTool({name:"continuum_request_context",arguments:{sessionId,query:"ReportFormatter.renderCsv",requestedSymbols:["ReportFormatter.renderCsv"]}}));
  expect(duplicate.newItems).toHaveLength(0);expect(duplicate.activeReferences.length).toBeGreaterThan(0);expect(duplicate.estimatedDuplicateTokensAvoided).toBeGreaterThan(0);expect(JSON.stringify(duplicate.activeReferences)).not.toContain("renderCsv():");
  const signal=async(signal:any)=>structured<any>(await client.callTool({name:"continuum_report_context_signal",arguments:{sessionId,signal}}));
  const testSignal=await signal({type:"test-failure",failingTests:["startup-timeout.test.ts"],errorSummary:"Expected timeout event",relatedPaths:["tests/startup-timeout.test.ts"]});
  const missingSignal=await signal({type:"missing-coverage",categories:["tests"]});
  const outsideSignal=await signal({type:"out-of-scope-modification",modifiedPaths:["security/policy.md"],predictedPaths:["src/auth-service.ts"]});
  expect(testSignal.trigger).toBe("test_failure");expect(missingSignal.trigger).toBe("missing_coverage");expect(outsideSignal.trigger).toBe("out_of_scope_modification");
  const aggregate=JSON.parse((await continuum(repository,"session","status",sessionId,"--json")).stdout);expect(aggregate.session.snapshot).toEqual(started.session.snapshot);
  const listed=structured<any>(await client.callTool({name:"continuum_list_context_sessions",arguments:{}}));expect(listed.sessions.some((x:any)=>x.session.id===sessionId)).toBe(true);
  const report=JSON.parse((await continuum(repository,"session","report",sessionId,"--json")).stdout);expect(report.schemaVersion).toBe("continuum.context-session-report.v1");expect(report.activity.deliveryCount).toBeGreaterThanOrEqual(5);expect(report.activity.activeReferenceCount).toBeGreaterThan(0);expect(report.context.estimatedDuplicateTokensAvoided).toBeGreaterThan(0);
  console.log({firstRequestInterface:"CLI",secondRequestInterface:"new MCP process",firstRequestNewItems:requested.newItems.length,secondRequestNewItems:duplicate.newItems.length,secondRequestActiveReferences:duplicate.activeReferences.length,repeatedFullContent:false,estimatedDuplicateTokensAvoided:duplicate.estimatedDuplicateTokensAvoided,testFailureNewItems:testSignal.newItems.length,missingCoverageNewItems:missingSignal.newItems.length,outOfScopeNewItems:outsideSignal.newItems.length,reportActivity:report.activity,reportContext:report.context,reportCoverage:report.coverage});
  const completed=structured<any>(await client.callTool({name:"continuum_complete_context_session",arguments:{sessionId,status:"completed"}}));expect(completed.status).toBe("completed");
  await client.close();
  const after=await continuum(repository,"session","request",sessionId,"refreshToken");expect(after.exitCode).not.toBe(0);expect(after.stderr).toContain("already completed");
  const db=openDatabase(join(repository,".continuum","continuum.db"));try{const initial=(db.prepare("SELECT COUNT(*) n FROM context_session_deliveries WHERE session_id=? AND stage='orientation'").get(sessionId) as {n:number}).n,active=(db.prepare("SELECT COUNT(*) n FROM context_session_delivery_items WHERE delivery_id IN(SELECT id FROM context_session_deliveries WHERE session_id=?) AND presence_state='active'").get(sessionId) as {n:number}).n;expect(initial).toBe(1);expect(active).toBe(0);}finally{db.close();}
 },120000);
 it("remediates snapshot mismatch and rejects malformed inputs",async()=>{
  await writeFile(join(repository,"src","auth-service.ts"),'export class AuthService { refreshToken(): string { return "changed"; } }\n');
  const mismatch=await continuum(repository,"session","start","Changed task","--json");expect(mismatch.exitCode).not.toBe(0);expect(mismatch.stderr).toContain("continuum index");
  const invalid=await continuum(repository,"session","start","Task","--budget-tokens","0");expect(invalid.exitCode).not.toBe(0);expect(invalid.stderr).toContain("positive integer");
  await connectMcp();
  const malformed=await client.callTool({name:"continuum_report_context_signal",arguments:{sessionId,signal:{type:"test-failure",failingTests:[]}}});expect(malformed.isError).toBe(true);
 },30000);
});
