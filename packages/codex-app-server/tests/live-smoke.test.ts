import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexExecutionService, CodexIntegrationError } from "../src/index.js";

const here=dirname(fileURLToPath(import.meta.url));const cli=resolve(here,"../../../apps/cli/dist/main.js");let root="";
interface Result{code:number;stdout:string;stderr:string}
function run(command:string,args:string[],cwd:string):Promise<Result>{return new Promise((done,reject)=>{const child=spawn(command,args,{cwd,env:process.env,windowsHide:true});let stdout="",stderr="";child.stdout.on("data",v=>stdout+=String(v));child.stderr.on("data",v=>stderr+=String(v));child.on("error",reject);child.on("close",code=>done({code:code??-1,stdout,stderr}));});}
afterAll(async()=>{if(root)await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:250});});

describe("installed Codex App Server live smoke",()=>{
  it("runs a genuine isolated shadow turn",async(context)=>{
    if(process.env["CONTINUUM_DISABLE_CODEX_LIVE"]==="1"){console.warn("SKIP: CONTINUUM_DISABLE_CODEX_LIVE=1 explicitly disabled the genuine Codex smoke test.");context.skip();return;}
    root=await mkdtemp(join(tmpdir(),"continuum-codex-live-"));const repo=join(root,"repository");await mkdir(repo);await mkdir(join(repo,"src"));
    await writeFile(join(repo,"src","add.ts"),"export const add = (_a: number, _b: number) => 0;\n");await writeFile(join(repo,"unrelated.txt"),"do not change\n");await writeFile(join(repo,"SECURITY.md"),"Only modify src/add.ts. Do not access files outside this repository.\n");
    for(const args of [["init"],["config","user.name","Continuum Live"],["config","user.email","live@example.test"],["add","."],["commit","-m","fixture"]]){const result=await run("git",args,repo);expect(result.code,result.stderr).toBe(0);}
    for(const args of [["init","--non-interactive"],["index"]]){const result=await run(process.execPath,[cli,...args],repo);expect(result.code,result.stderr).toBe(0);}
    try{
      const result=await new CodexExecutionService().runShadow({cwd:repo,task:"Fix src/add.ts so add(1, 2) returns 3. Do not modify unrelated.txt.",mode:"shadow",model:"gpt-5.5",sandbox:"workspace-write",approvalPolicy:"never",timeoutMs:300000});
      expect(result.report.execution.codexVersion).not.toBe("fixture");expect(result.authenticationMode).not.toBe("none");expect(result.report.execution.status).toBe("completed");expect(await readFile(join(repo,"src","add.ts"),"utf8")).toContain("a + b");expect(await readFile(join(repo,"unrelated.txt"),"utf8")).toBe("do not change\n");
      console.log(JSON.stringify({executionId:result.executionId,codexVersion:result.report.execution.codexVersion,authenticationMode:result.authenticationMode,status:result.report.execution.status,changedFiles:result.report.outcome.changedFileCount,testsObserved:result.report.outcome.testsObserved,usageAvailability:result.report.usage.availability,durationMs:result.report.execution.durationMs}));
    }catch(error){
      if(error instanceof CodexIntegrationError&&["CODEX_EXECUTABLE_UNAVAILABLE","APP_SERVER_UNAVAILABLE","AUTHENTICATION_REQUIRED"].includes(error.code)){console.warn(`SKIP: genuine Codex smoke unavailable: ${error.code}: ${error.message}`);context.skip();return;}
      throw error;
    }
  },360000);
});
