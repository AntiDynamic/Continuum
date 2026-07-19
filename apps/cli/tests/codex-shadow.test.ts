import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@continuum/database";

const here=dirname(fileURLToPath(import.meta.url));
const cli=resolve(here,"../dist/main.js");
const fake=resolve(here,"../../../packages/codex-app-server/tests/fixtures/fake-app-server.mjs");
interface Result{exitCode:number;stdout:string;stderr:string}
function run(command:string,args:string[],cwd:string,env:NodeJS.ProcessEnv=process.env):Promise<Result>{return new Promise((done,reject)=>{const child=spawn(command,args,{cwd,env,windowsHide:true});let stdout="",stderr="";child.stdout.on("data",v=>stdout+=String(v));child.stderr.on("data",v=>stderr+=String(v));child.on("error",reject);child.on("close",code=>done({exitCode:code??-1,stdout:stdout.trim(),stderr:stderr.trim()}));});}
const git=(cwd:string,...args:string[])=>run("git",args,cwd);
const continuum=(cwd:string,args:string[],env:NodeJS.ProcessEnv=process.env)=>run(process.execPath,[cli,...args],cwd,env);

describe("Phase 4A full shadow integration",()=>{
  let root:string;let repo:string;
  beforeAll(async()=>{
    root=await mkdtemp(join(tmpdir(),"continuum-codex-shadow-"));repo=join(root,"repository");await mkdir(repo);await mkdir(join(repo,"src"));await mkdir(join(repo,"tests"));
    await writeFile(join(repo,"src","add.ts"),"export const add = () => 0;\n");
    await writeFile(join(repo,"tests","add.test.ts"),'import { add } from "../src/add.js";\nif (add(1,2) !== 3) throw new Error("add failed");\n');
    await writeFile(join(repo,"SECURITY.md"),"# Security\nDo not weaken input validation or modify unrelated files.\n");
    await writeFile(join(repo,"unrelated.txt"),"must remain unchanged\n");
    await git(repo,"init");await git(repo,"config","user.name","Continuum Acceptance");await git(repo,"config","user.email","acceptance@example.test");await git(repo,"add",".");await git(repo,"commit","-m","fixture");
    expect((await continuum(repo,["init","--non-interactive"])).exitCode).toBe(0);expect((await continuum(repo,["index"])).exitCode).toBe(0);
  },60000);
  afterAll(async()=>{if(root)await rm(root,{recursive:true,force:true});});

  it("records a real-stdio fixture run without injecting prediction content",async()=>{
    const task="Fix the failing add function test without modifying unrelated files.";
    const env={...process.env,NODE_ENV:"test",CONTINUUM_CODEX_TEST_APP_SERVER:fake,FAKE_CODEX_APPLY_PATCH:"1"};
    const result=await continuum(repo,["codex",task,"--mode","shadow","--approval-policy","never","--sandbox","workspace-write","--json"],env);
    expect(result.exitCode,result.stderr).toBe(0);const output=JSON.parse(result.stdout);expect(output.report.execution.status).toBe("completed");expect(await readFile(join(repo,"src","add.ts"),"utf8")).toContain("a + b");expect(await readFile(join(repo,"unrelated.txt"),"utf8")).toBe("must remain unchanged\n");
    const db=openDatabase(join(repo,".continuum","continuum.db"));
    try{
      const execution=db.prepare("SELECT * FROM codex_executions WHERE id=?").get(output.executionId) as any;expect(execution.status).toBe("completed");
      const session=db.prepare("SELECT * FROM context_sessions WHERE id=?").get(output.sessionId) as any;expect(session.status).toBe("completed");
      const firstDelivery=db.prepare("SELECT MIN(created_at) at FROM context_session_deliveries WHERE session_id=?").get(output.sessionId) as {at:string};const firstRaw=db.prepare("SELECT MIN(timestamp) at FROM codex_raw_events WHERE execution_id=?").get(output.executionId) as {at:string};expect(firstDelivery.at<=firstRaw.at).toBe(true);
      const raw=db.prepare("SELECT * FROM codex_raw_events WHERE execution_id=? ORDER BY sequence_number").all(output.executionId) as any[];expect(raw.map(row=>row.sequence_number)).toEqual(raw.map((_,index)=>index+1));
      const turnStart=raw.find(row=>row.method==="turn/start");const outbound=JSON.parse(turnStart.raw_json);expect(outbound.params.input).toEqual([{type:"text",text:task,text_elements:[]}]);expect(turnStart.raw_json).not.toContain("SECURITY.md");
      const normalized=db.prepare("SELECT * FROM codex_normalized_events WHERE execution_id=?").all(output.executionId) as any[];const rawSequences=new Set(raw.map(row=>row.sequence_number));expect(normalized.every(row=>rawSequences.has(row.raw_sequence_number))).toBe(true);expect(normalized.some(row=>row.event_type==="test_execution")).toBe(true);
      const usage=db.prepare("SELECT * FROM codex_usage_snapshots WHERE execution_id=?").all(output.executionId) as any[];expect(usage.some(row=>row.measurement==="measured"&&row.accumulation==="accumulated")).toBe(true);expect(db.prepare("SELECT COUNT(*) n FROM codex_turn_diffs WHERE execution_id=?").get(output.executionId)).toMatchObject({n:1});
    }finally{db.close();}
    expect(output.report.comparison.predictedAndObserved).toBeDefined();expect(output.report.outcome.testsPassed).toBe(true);expect(output.report.outcome.diffCaptured).toBe(true);
    const restarted=await continuum(repo,["codex","report",output.executionId,"--json"]);expect(restarted.exitCode,restarted.stderr).toBe(0);expect(JSON.parse(restarted.stdout)).toEqual(output.report);
  },120000);

  it("fails authentication actionably and closes the predicted session",async()=>{
    expect((await continuum(repo,["index"])).exitCode).toBe(0);
    const env={...process.env,NODE_ENV:"test",CONTINUUM_CODEX_TEST_APP_SERVER:fake,FAKE_CODEX_SCENARIO:"unauthenticated"};
    const result=await continuum(repo,["codex","Authentication failure fixture","--mode","shadow","--json"],env);expect(result.exitCode).not.toBe(0);expect(result.stderr).toContain("AUTHENTICATION_REQUIRED");expect(result.stderr).toContain("codex login");
    const db=openDatabase(join(repo,".continuum","continuum.db"));try{const execution=db.prepare("SELECT * FROM codex_executions ORDER BY rowid DESC LIMIT 1").get() as any;expect(execution.status).toBe("failed");expect(execution.failure_code).toBe("AUTHENTICATION_REQUIRED");expect((db.prepare("SELECT status FROM context_sessions WHERE id=?").get(execution.session_id) as any).status).toBe("failed");}finally{db.close();}
  },120000);

  it("retains partial evidence and a restart-safe report after unexpected exit",async()=>{
    expect((await continuum(repo,["index"])).exitCode).toBe(0);
    const env={...process.env,NODE_ENV:"test",CONTINUUM_CODEX_TEST_APP_SERVER:fake,FAKE_CODEX_SCENARIO:"unexpected-exit"};
    const result=await continuum(repo,["codex","Unexpected exit fixture","--mode","shadow","--json"],env);expect(result.exitCode).not.toBe(0);expect(result.stderr).toContain("UNEXPECTED_PROCESS_EXIT");
    const db=openDatabase(join(repo,".continuum","continuum.db"));let id="";try{const execution=db.prepare("SELECT * FROM codex_executions ORDER BY rowid DESC LIMIT 1").get() as any;id=execution.id;expect(execution.status).toBe("failed");expect((db.prepare("SELECT COUNT(*) n FROM codex_raw_events WHERE execution_id=?").get(id) as any).n).toBeGreaterThan(0);expect((db.prepare("SELECT COUNT(*) n FROM codex_normalized_events WHERE execution_id=? AND event_type='process_exit'").get(id) as any).n).toBe(1);expect((db.prepare("SELECT status FROM context_sessions WHERE id=?").get(execution.session_id) as any).status).toBe("failed");}finally{db.close();}
    const report=await continuum(repo,["codex","report",id,"--json"]);expect(report.exitCode,report.stderr).toBe(0);expect(JSON.parse(report.stdout).execution.status).toBe("failed");
  },120000);

  it("rejects an unsupported server request safely while preserving the run",async()=>{
    expect((await continuum(repo,["index"])).exitCode).toBe(0);
    const env={...process.env,NODE_ENV:"test",CONTINUUM_CODEX_TEST_APP_SERVER:fake,FAKE_CODEX_SCENARIO:"unsupported-request"};
    const result=await continuum(repo,["codex","Unsupported request fixture","--mode","shadow","--json"],env);expect(result.exitCode,result.stderr).toBe(0);const output=JSON.parse(result.stdout);
    const db=openDatabase(join(repo,".continuum","continuum.db"));try{const raw=db.prepare("SELECT raw_json FROM codex_raw_events WHERE execution_id=? AND direction='client_to_server' AND message_category='response'").all(output.executionId) as Array<{raw_json:string}>;expect(raw.some(row=>JSON.parse(row.raw_json).error?.code===-32601)).toBe(true);}finally{db.close();}
  },120000);

});
