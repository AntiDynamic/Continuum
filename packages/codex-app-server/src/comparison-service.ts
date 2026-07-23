import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutionService, type CodexShadowOptions, openCodexDatabase } from "./execution-service.js";
import { CodexAssistExecutionService } from "./assist-execution-service.js";

export interface CodexCompareOptions extends Omit<CodexShadowOptions, "mode"> { verifierCommand: string; verifierTimeoutMs?: number; }
export interface ComparisonWorkspace { commit: string; shadowWorktreePath: string; assistWorktreePath: string; shadowDatabasePath: string; assistDatabasePath: string; cleanup(): void; }
export interface CodexComparisonResult { id:string; shadowExecutionId:string; shadowVerifierSuccess:boolean; shadowVerifierOutput:string; assistExecutionId:string; assistVerifierSuccess:boolean; assistVerifierOutput:string; commit:string; shadowWorktreePath:string; assistWorktreePath:string; shadowDatabasePath:string; assistDatabasePath:string; }

function verifier(command:string,cwd:string,timeoutMs:number):{success:boolean;output:string}{const result=spawnSync(command,{cwd,shell:true,encoding:"utf8",timeout:timeoutMs,windowsHide:true});const output=`${result.stdout??""}${result.stderr??""}${result.error?`\n${result.error.message}`:""}`;return {success:result.status===0&&!result.error,output};}
function git(cwd:string,args:string[]):string{return execFileSync("git",args,{cwd,encoding:"utf8",windowsHide:true}).trim();}
function provisionDatabase(source:string,target:string):string{const sourceDir=join(source,".continuum"),targetDir=join(target,".continuum");if(!existsSync(join(sourceDir,"continuum.db"))||!existsSync(join(sourceDir,"config.json")))throw new Error("Continuum is not initialized in the comparison source repository.");cpSync(sourceDir,targetDir,{recursive:true,force:true});const opened=awaitedDatabase(target);try{opened.db.prepare("UPDATE repositories SET canonical_path=?").run(opened.root);}finally{opened.db.close();}return join(targetDir,"continuum.db");}
function awaitedDatabase(cwd:string):{db:Awaited<ReturnType<typeof openCodexDatabase>> extends {db:infer D}?D:never;root:string}{throw new Error("synchronous database provisioning is unavailable");}

export class CodexComparisonService {
  async prepareComparison(cwd:string,repository?:string):Promise<ComparisonWorkspace>{
    const opened=await openCodexDatabase(cwd,repository);const source=opened.root;opened.db.close();
    const commit=git(source,["rev-parse","HEAD"]);
    const shadowWorktreePath=mkdtempSync(join(tmpdir(),"continuum-shadow-")),assistWorktreePath=mkdtempSync(join(tmpdir(),"continuum-assist-"));
    try{
      execFileSync("git",["worktree","add","--detach",shadowWorktreePath,commit],{cwd:source,stdio:"ignore",windowsHide:true});
      execFileSync("git",["worktree","add","--detach",assistWorktreePath,commit],{cwd:source,stdio:"ignore",windowsHide:true});
      const sourceDir=join(source,".continuum");
      if(!existsSync(join(sourceDir,"continuum.db"))||!existsSync(join(sourceDir,"config.json")))throw new Error("Continuum is not initialized in the comparison source repository.");
      cpSync(sourceDir,join(shadowWorktreePath,".continuum"),{recursive:true,force:true});
      cpSync(sourceDir,join(assistWorktreePath,".continuum"),{recursive:true,force:true});
      const shadow=await openCodexDatabase(shadowWorktreePath);shadow.db.prepare("UPDATE repositories SET canonical_path=?").run(shadow.root);shadow.db.close();
      const assist=await openCodexDatabase(assistWorktreePath);assist.db.prepare("UPDATE repositories SET canonical_path=?").run(assist.root);assist.db.close();
      return {commit,shadowWorktreePath,assistWorktreePath,shadowDatabasePath:join(shadowWorktreePath,".continuum","continuum.db"),assistDatabasePath:join(assistWorktreePath,".continuum","continuum.db"),cleanup:()=>{for(const path of [shadowWorktreePath,assistWorktreePath]){try{execFileSync("git",["worktree","remove","--force",path],{cwd:source,stdio:"ignore",windowsHide:true});}catch{}try{rmSync(path,{recursive:true,force:true});}catch{}}}};
    }catch(error){for(const path of [shadowWorktreePath,assistWorktreePath]){try{rmSync(path,{recursive:true,force:true});}catch{}}throw error;}
  }
  async runComparison(options:CodexCompareOptions):Promise<CodexComparisonResult>{
    const workspace=await this.prepareComparison(options.cwd,options.repository);
    try{
      const shadow=await new CodexExecutionService().runShadow({...options,cwd:workspace.shadowWorktreePath,mode:"shadow"});
      const shadowVerifier=verifier(options.verifierCommand,workspace.shadowWorktreePath,options.verifierTimeoutMs??120_000);
      const assist=await new CodexAssistExecutionService().runAssist({...options,cwd:workspace.assistWorktreePath});
      const assistVerifier=verifier(options.verifierCommand,workspace.assistWorktreePath,options.verifierTimeoutMs??120_000);
      const source=await openCodexDatabase(options.cwd,options.repository);const row=source.db.prepare("SELECT id FROM repositories WHERE canonical_path=?").get(source.root) as {id:number}|undefined;if(!row)throw new Error("Comparison source repository is not indexed.");const id=crypto.randomUUID();const outcome=shadowVerifier.success===assistVerifier.success?(shadowVerifier.success?"both_passed":"both_failed"):assistVerifier.success?"improvement":"regression";
      source.db.prepare("INSERT INTO codex_comparison_runs(id,repository_id,task_text,shadow_execution_id,assist_execution_id,verifier_command,shadow_exit_code,assist_exit_code,shadow_stdout_path,shadow_stderr_path,assist_stdout_path,assist_stderr_path,outcome,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,row.id,options.task,null,null,options.verifierCommand,shadowVerifier.success?0:1,assistVerifier.success?0:1,null,null,null,null,outcome,new Date().toISOString());source.db.close();
      return {id,shadowExecutionId:shadow.executionId,shadowVerifierSuccess:shadowVerifier.success,shadowVerifierOutput:shadowVerifier.output,assistExecutionId:assist.executionId,assistVerifierSuccess:assistVerifier.success,assistVerifierOutput:assistVerifier.output,commit:workspace.commit,shadowWorktreePath:workspace.shadowWorktreePath,assistWorktreePath:workspace.assistWorktreePath,shadowDatabasePath:workspace.shadowDatabasePath,assistDatabasePath:workspace.assistDatabasePath};
    }finally{workspace.cleanup();}
  }
}