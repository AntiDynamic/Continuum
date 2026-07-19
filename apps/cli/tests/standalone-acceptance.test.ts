import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp,mkdir,rm,writeFile,rename,unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname,join,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@continuum/database";
const here=dirname(fileURLToPath(import.meta.url)),cli=resolve(here,"../dist/main.js");
interface Result{exitCode:number;stdout:string;stderr:string}
function run(command:string,args:string[],cwd:string):Promise<Result>{return new Promise((done,reject)=>{const child=spawn(command,args,{cwd,env:process.env,windowsHide:true});let stdout="",stderr="";child.stdout.on("data",v=>stdout+=String(v));child.stderr.on("data",v=>stderr+=String(v));child.on("error",reject);child.on("close",code=>done({exitCode:code??-1,stdout:stdout.trim(),stderr:stderr.trim()}));});}
const git=(cwd:string,...args:string[])=>run("git",args,cwd);
const continuum=(cwd:string,...args:string[])=>run(process.execPath,[cli,...args],cwd);
async function repository(root:string,name:string,index=true):Promise<string>{const dir=join(root,name);await mkdir(dir);await git(dir,"init");await git(dir,"config","user.name","Acceptance");await git(dir,"config","user.email","acceptance@example.test");await mkdir(join(dir,"src"));await mkdir(join(dir,"tests"));await mkdir(join(dir,"security"));await writeFile(join(dir,"src","auth.ts"),'export class AuthService { validateToken(): boolean { return true; } }\n');await writeFile(join(dir,"src","formatter.ts"),'export class ReportFormatter { renderCsv(): string { return "csv"; } }\n');await writeFile(join(dir,"tests","auth-timeout.test.ts"),'export const authTimeoutTest = "AuthService.validateToken";\n');await writeFile(join(dir,"security","policy.md"),"# Trust\nNever weaken token validation.\n");for(let i=0;i<14;i++)await writeFile(join(dir,"src","module-"+i+".ts"),"export function module"+i+"Value() { return "+i+"; }\n");await git(dir,"add",".");await git(dir,"commit","-m","fixture");expect((await continuum(dir,"init","--non-interactive")).exitCode).toBe(0);if(index)expect((await continuum(dir,"index")).exitCode).toBe(0);return dir;}
const cleanFailure=(result:Result,text:string)=>{expect(result.exitCode).not.toBe(0);expect(result.stderr.toLowerCase()).toContain(text.toLowerCase());expect(result.stderr).not.toMatch(/\n\s+at\s/);};
describe("Phase 3C standalone acceptance",()=>{
 let root:string,repo:string,sessionId:string,snapshot:any;
 beforeAll(async()=>{root=await mkdtemp(join(tmpdir(),"continuum-standalone-"));repo=await repository(root,"primary");},60000);
 afterAll(async()=>{if(root)await rm(root,{recursive:true,force:true});});
 it("survives fresh processes and reconstructs all evidence",async()=>{
  const start=await continuum(repo,"session","start","Fix authentication timeout without weakening trust validation","--initial-context","--json");expect(start.exitCode,start.stderr).toBe(0);const started=JSON.parse(start.stdout);sessionId=started.session.id;snapshot=started.session.snapshot;
  const status=JSON.parse((await continuum(repo,"session","status",sessionId,"--json")).stdout);expect(status.session.snapshot).toEqual(snapshot);
  const initial=JSON.parse((await continuum(repo,"session","context",sessionId,"--json")).stdout).packet;expect(initial.id).toBe(started.initialContext.id);
  const first=JSON.parse((await continuum(repo,"session","request",sessionId,"Show ReportFormatter.renderCsv","--symbol","ReportFormatter.renderCsv","--json")).stdout).packet;expect(first.newItems.length).toBeGreaterThan(0);expect(first.newItems.some((x:any)=>x.content.includes("renderCsv"))).toBe(true);
  const repeated=JSON.parse((await continuum(repo,"session","request",sessionId,"Show ReportFormatter.renderCsv","--symbol","ReportFormatter.renderCsv","--json")).stdout).packet;expect(repeated.newItems).toHaveLength(0);expect(repeated.activeReferences.length).toBeGreaterThan(0);expect(JSON.stringify(repeated.activeReferences)).not.toContain("renderCsv():");expect(repeated.estimatedDuplicateTokensAvoided).toBeGreaterThan(0);
  const signal=JSON.parse((await continuum(repo,"session","signal",sessionId,"--type","test-failure","--tests","tests/auth-timeout.test.ts","--error","Expected timeout event","--json")).stdout).result;expect(signal.trigger).toBe("test_failure");
  const report=JSON.parse((await continuum(repo,"session","report",sessionId,"--json")).stdout);expect(report.activity.deliveryCount).toBeGreaterThanOrEqual(4);expect(report.context.estimatedDuplicateTokensAvoided).toBeGreaterThan(0);expect(report.activity.signalCount).toBe(3);
  expect((await continuum(repo,"session","complete",sessionId,"--status","completed","--json")).exitCode).toBe(0);cleanFailure(await continuum(repo,"session","request",sessionId,"again"),"already completed");
  const db=openDatabase(join(repo,".continuum","continuum.db"));try{expect((db.prepare("SELECT COUNT(*) n FROM context_session_deliveries WHERE session_id=? AND stage='orientation'").get(sessionId) as {n:number}).n).toBe(1);expect((db.prepare("SELECT COUNT(*) n FROM context_session_signals WHERE session_id=? AND decision_json IS NOT NULL").get(sessionId) as {n:number}).n).toBe(3);expect((db.prepare("SELECT COUNT(*) n FROM context_session_delivery_items WHERE delivery_id IN(SELECT id FROM context_session_deliveries WHERE session_id=?) AND presence_state='active'").get(sessionId) as {n:number}).n).toBe(0);}finally{db.close();}
  console.log({sessionId,firstNew:first.newItems.length,repeatedNew:repeated.newItems.length,repeatedReferences:repeated.activeReferences.length,duplicateEstimate:repeated.estimatedDuplicateTokensAvoided,deliveries:report.activity.deliveryCount});
 },90000);
 it("handles adversarial repository, input, lifecycle, and concurrency cases",async()=>{
  const uninit=join(root,"uninitialized");await mkdir(uninit);await git(uninit,"init");cleanFailure(await continuum(uninit,"session","start","Task"),"not initialised");
  const notIndexed=await repository(root,"not-indexed",false);cleanFailure(await continuum(notIndexed,"session","start","Task"),"not indexed");
  cleanFailure(await continuum(repo,"session","start","Task","--budget-tokens","0"),"positive integer");
  cleanFailure(await continuum(repo,"session","status","00000000-0000-4000-8000-000000000000"),"not found");
  cleanFailure(await continuum(repo,"session","status","not-a-uuid"),"not found");
  cleanFailure(await continuum(repo,"session","request",sessionId,"query","--coverage","unsupported"),"unsupported coverage");
  const malformed=await continuum(repo,"session","request",sessionId,"--json");expect(malformed.exitCode).not.toBe(0);expect(malformed.stderr).not.toMatch(/\n\s+at\s/);
  const foreign=await repository(root,"foreign");cleanFailure(await continuum(foreign,"session","status",sessionId),"not found");
  const small=JSON.parse((await continuum(repo,"session","start","Fix timeout test","--budget-tokens","1","--initial-context","--json")).stdout);expect(small.initialContext.incomplete).toBe(true);expect(small.initialContext.coverageRemaining.length).toBeGreaterThan(0);
  const initialAgain=JSON.parse((await continuum(repo,"session","context",small.session.id,"--json")).stdout).packet;expect(initialAgain.id).toBe(small.initialContext.id);
  for(const state of ["failed","cancelled"]){const item=JSON.parse((await continuum(repo,"session","start","Lifecycle "+state,"--json")).stdout);expect((await continuum(repo,"session","complete",item.session.id,"--status",state,"--json")).exitCode).toBe(0);cleanFailure(await continuum(repo,"session","request",item.session.id,"again"),"already completed");}
  const active=JSON.parse((await continuum(repo,"session","start","Concurrent reads","--json")).stdout).session.id;
  const concurrent=await Promise.all([...Array(4)].flatMap(()=>[continuum(repo,"session","status",active,"--json"),continuum(repo,"session","report",active,"--json")]));expect(concurrent.every(x=>x.exitCode===0)).toBe(true);
  const interrupted=spawn(process.execPath,[cli,"session","report",active,"--json"],{cwd:repo,windowsHide:true});interrupted.kill();await new Promise(done=>interrupted.once("close",done));expect((await continuum(repo,"session","status",active,"--json")).exitCode).toBe(0);
  await writeFile(join(repo,"untracked-after-index.ts"),"export const dirty = true;\n");cleanFailure(await continuum(repo,"session","start","Dirty"),"continuum index");await unlink(join(repo,"untracked-after-index.ts"));
  await rename(join(repo,"src","formatter.ts"),join(repo,"src","renamed-formatter.ts"));cleanFailure(await continuum(repo,"session","start","Renamed"),"continuum index");await rename(join(repo,"src","renamed-formatter.ts"),join(repo,"src","formatter.ts"));
  await unlink(join(repo,"src","formatter.ts"));cleanFailure(await continuum(repo,"session","start","Deleted"),"continuum index");await writeFile(join(repo,"src","formatter.ts"),'export class ReportFormatter { renderCsv(): string { return "csv"; } }\n');
  expect((await continuum(repo,"index")).exitCode).toBe(0);
  const db=openDatabase(join(repo,".continuum","continuum.db"));try{expect((db.prepare("PRAGMA integrity_check").get() as {integrity_check:string}).integrity_check).toBe("ok");}finally{db.close();}
 },120000);
});
