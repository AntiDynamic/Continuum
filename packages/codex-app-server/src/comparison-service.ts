import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, redactString, capturePolicyFor } from "@continuum/shared";
import { resolveSnapshotIdentity, getRepositoryRoot } from "@continuum/git-analyzer";
import { CodexExecutionService, openCodexDatabase, type CodexShadowOptions } from "./execution-service.js";
import { CodexAssistExecutionService } from "./assist-execution-service.js";
import { buildShadowReport, type ShadowFlightRecorderReport } from "./report.js";
const command = promisify(execFile), shell = promisify(exec);
export interface CodexCompareOptions extends Omit<CodexShadowOptions, "mode"> { verifierCommand:string; preparationCommand?:string; order?:"shadow-first"|"assist-first" }
export interface CodexComparisonResult { id:string;shadowExecutionId:string;shadowVerifierSuccess:boolean;shadowVerifierOutput:string;assistExecutionId:string;assistVerifierSuccess:boolean;assistVerifierOutput:string }
const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/cli/dist/main.js");
async function verify(text:string,cwd:string,timeoutMs:number) {
  const policy=capturePolicyFor(cwd);
  const output=(value:string)=>policy.captureRawOutput===false?"[capture disabled]":redactString(value,policy.redactPatterns);
  try { const result=await shell(text,{cwd,timeout:timeoutMs,maxBuffer:4*1024*1024});return{success:true,output:output(result.stdout),exitCode:0}; }
  catch(error){const err=error as {stdout?:string;stderr?:string;message:string;code?:number};return{success:false,output:output((err.stdout??"")+"\n"+(err.stderr??err.message)),exitCode:typeof err.code==="number"?err.code:1};}
}
export class CodexComparisonService {
  async runComparison(options:CodexCompareOptions):Promise<CodexComparisonResult> {
    const root=await getRepositoryRoot(resolve(options.cwd,options.repository??"."));
    const snapshot=await resolveSnapshotIdentity(root);
    if(snapshot.dirty)throw new Error("Comparison requires a clean committed snapshot; commit or isolate existing changes first.");
    const scratch=await mkdtemp(join(tmpdir(),"continuum-compare-")), id=crypto.randomUUID(), directories={shadow:join(scratch,"shadow"),assist:join(scratch,"assist")};
    const artifacts=join(root,".continuum","comparisons",id);
    await mkdir(artifacts,{recursive:true});
    const results=new Map<string,any>();
    const persistReport=async(report:ShadowFlightRecorderReport)=>{
      const opened=await openCodexDatabase(root);
      try {
        const repo=opened.db.prepare("SELECT id FROM repositories WHERE canonical_path=?").get(root) as {id:number};
        opened.db.prepare("INSERT OR REPLACE INTO codex_external_reports VALUES(?,?,?,?)").run(report.execution.executionId,repo.id,JSON.stringify(report),new Date().toISOString());
      } finally {opened.db.close();}
    };
    try {
      for(const cwd of Object.values(directories)) {
        await command("git",["worktree","add","--detach",cwd,snapshot.base_commit_hash],{cwd:root});
        await mkdir(join(cwd,".continuum"));
        await writeFile(join(cwd,".continuum/config.json"),await readFile(join(root,".continuum/config.json"),"utf8").catch(()=>JSON.stringify(DEFAULT_CONFIG)));
        let ignore="";try{ignore=await readFile(join(cwd,".gitignore"),"utf8");}catch{}
        await writeFile(join(cwd,".gitignore"),ignore+"\n.continuum/\n");
        if(options.preparationCommand){const prepared=await verify(options.preparationCommand,cwd,options.timeoutMs??300000);if(!prepared.success)throw new Error("Comparison preparation failed: "+prepared.output);}
        await command(process.execPath,[cli,"index"],{cwd,timeout:60000});
      }
      const order=options.order??(Math.random()<0.5?"shadow-first":"assist-first");
      for(const mode of order==="shadow-first"?["shadow","assist"] as const:["assist","shadow"] as const) {
        const cwd=directories[mode],cell={...options,cwd,repository:undefined};
        let result;
        try {
          result=mode==="shadow"?await new CodexExecutionService().runShadow({...cell,mode:"shadow"}):await new CodexAssistExecutionService().runAssist(cell);
        } catch(error) {
          const partial=await openCodexDatabase(cwd);
          try {
            const execution=partial.db.prepare("SELECT id FROM codex_executions ORDER BY rowid DESC LIMIT 1").get() as {id:string}|undefined;
            if(execution){
              const report=buildShadowReport(partial.db,execution.id,cwd);
              await persistReport(report);
              await writeFile(join(artifacts,mode+".json"),JSON.stringify({report,error:redactString(String(error),capturePolicyFor(root).redactPatterns),order,baseCommit:snapshot.base_commit_hash},null,2));
            }
          } finally {partial.db.close();}
          await copyFile(join(cwd,".continuum/continuum.db"),join(artifacts,mode+".db"));
          throw error;
        }
        await persistReport(result.report);
        await copyFile(join(cwd,".continuum/continuum.db"),join(artifacts,mode+".db"));
        const verification=await verify(options.verifierCommand,cwd,options.timeoutMs??300000);
        await writeFile(join(artifacts,mode+".json"),JSON.stringify({report:result.report,verification,order,baseCommit:snapshot.base_commit_hash},null,2));
        results.set(mode,{result,verification});
      }
      const opened=await openCodexDatabase(root);
      try {
        const repo=opened.db.prepare("SELECT id FROM repositories WHERE canonical_path=?").get(root) as {id:number};
        const shadow=results.get("shadow"),assist=results.get("assist");
        const outcome=shadow.verification.success&&assist.verification.success?"both_passed":shadow.verification.success?"regression":assist.verification.success?"improvement":"both_failed";
        opened.db.prepare("INSERT INTO codex_comparison_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,repo.id,options.task,shadow.result.executionId,assist.result.executionId,options.verifierCommand,shadow.verification.exitCode,assist.verification.exitCode,join(artifacts,"shadow.json"),null,join(artifacts,"assist.json"),null,outcome,new Date().toISOString());
        return{id,shadowExecutionId:shadow.result.executionId,shadowVerifierSuccess:shadow.verification.success,shadowVerifierOutput:shadow.verification.output,assistExecutionId:assist.result.executionId,assistVerifierSuccess:assist.verification.success,assistVerifierOutput:assist.verification.output};
      } finally {opened.db.close();}
    } finally {
      for(const cwd of Object.values(directories)) await command("git",["worktree","remove","--force",cwd],{cwd:root}).catch(()=>undefined);
      await rm(scratch,{recursive:true,force:true});
    }
  }
}
