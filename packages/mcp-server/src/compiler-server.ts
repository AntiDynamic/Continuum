import { CONTINUUM_VERSION } from "@continuum/shared";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ContextEngine, RepositoryContextSessionService } from "@continuum/context-engine";
import { RepositoryRepository, migrate, openDatabase } from "@continuum/database";
import { getRepositoryRoot, resolveSnapshotIdentity } from "@continuum/git-analyzer";
import type { ContextControlSignal } from "@continuum/shared";

interface EngineScope { engine:ContextEngine;close():void }
function compactText(value:unknown):string{
  if(!value||typeof value!=="object")return JSON.stringify(value);
  const record=value as Record<string,unknown>;
  if(Array.isArray(record["newItems"])){
    const items=(record["newItems"] as Array<Record<string,unknown>>).map(item=>{const candidate=(item["candidate"]??{}) as Record<string,unknown>,metadata=(candidate["item"]??{}) as Record<string,unknown>;return{path:metadata["source_path"],title:metadata["title"]??metadata["symbol_name"],content:item["content"]};});
    return JSON.stringify({stage:record["stage"],sessionId:record["sessionId"],coverageAdded:record["coverageAdded"],coverageRemaining:record["coverageRemaining"],cacheDelivery:record["cacheDelivery"]??null,items});
  }
  if(record["initialContext"]&&typeof record["initialContext"]==="object"){
    const session=(record["session"]??{}) as Record<string,unknown>;
    return JSON.stringify({schemaVersion:record["schemaVersion"],session:{id:session["id"],task:(session["task"] as Record<string,unknown> | undefined)?.["originalTask"],status:session["status"]},requiredCoverage:record["requiredCoverage"],initialContext:JSON.parse(compactText(record["initialContext"]))});
  }
  if(typeof record["sessionId"]==="string"&&Array.isArray(record["activeContext"]))return JSON.stringify({schemaVersion:record["schemaVersion"],sessionId:record["sessionId"],task:record["task"],status:record["status"],nextAction:record["nextAction"],coverageRemaining:record["coverageRemaining"],activeContext:record["activeContext"],blockers:record["blockers"]});
  return JSON.stringify(value);
}
function protocolResult(value:unknown,compact=process.env["CONTINUUM_MCP_COMPACT"]==="1"){
  const record=value as {schemaVersion?:string;renderedContent?:string;incomplete?:boolean;found?:boolean;omittedCriticalIds?:string[];initialContext?:{renderedContent?:string}};
  const rendered=record?.renderedContent??record?.initialContext?.renderedContent;
  const memoryFailure=(record.schemaVersion==="continuum.durable-recovery.v1"||typeof record.found==="boolean")&&(record.incomplete===true||record.found===false);
  if(rendered!==undefined)return{content:[{type:"text" as const,text:rendered}],...(memoryFailure?{isError:true}:{}),...(process.env["CONTINUUM_MCP_AUDIT"]==="1"?{structuredContent:value as Record<string,unknown>}:memoryFailure?{structuredContent:{incomplete:record.incomplete??false,found:record.found??true,omittedCriticalIds:record.omittedCriticalIds??[]}}:{})};
return compact?{content:[{type:"text" as const,text:compactText(value)}]}:{content:[{type:"text" as const,text:compactText(value)}],structuredContent:value as Record<string,unknown>};}
const coverage=z.enum(["implementation","public_contract","tests","configuration","architecture","security_constraint","database_schema","rollback","dependency","documentation","historical_episode","repository_state"]);
const finalStatus=z.enum(["completed","failed","cancelled"]);
const sessionStatus=z.enum(["planning","active","checkpointed","completed","failed","cancelled"]);
const errorResult=(error:unknown)=>({...protocolResult({error:error instanceof Error?error.message:String(error)}),isError:true});

export class ContinuumMcpServer {
  private readonly server=new McpServer({name:"Continuum",version:CONTINUUM_VERSION});
  constructor(private readonly cwd:string){this.setupTools();}
  private async scopedEngine(requestedPath?:string):Promise<EngineScope>{
    const repositoryRoot=await getRepositoryRoot(this.cwd),target=resolve(this.cwd,requestedPath??"."),fromRoot=relative(repositoryRoot,target);
    if(isAbsolute(fromRoot)||fromRoot===".."||fromRoot.startsWith(".."+(process.platform==="win32"?"\\":"/")))throw new Error("Requested path is outside the configured repository root.");
    const dbPath=join(repositoryRoot,".continuum","continuum.db");if(!existsSync(dbPath))throw new Error("Continuum is not initialised at "+repositoryRoot+".");
    const db=openDatabase(dbPath);migrate(db);const repository=new RepositoryRepository(db).findByPath(repositoryRoot);
    if(!repository){db.close();throw new Error("Repository is not registered in the Continuum database.");}
    const snapshot=await resolveSnapshotIdentity(repositoryRoot);return{engine:new ContextEngine(db,repository.id,snapshot),close:()=>db.close()};
  }
  private async withSession<T>(operation:(service:RepositoryContextSessionService)=>Promise<T>):Promise<T>{const service=await RepositoryContextSessionService.open(this.cwd);try{return await operation(service);}finally{service.close();}}
  private setupTools():void{
    const searchSchema={query:z.string().min(1),path:z.string().optional().describe("Repository-contained path only.")};
    const compact=process.env["CONTINUUM_MCP_COMPACT"]==="1";
    const targeted=process.env["CONTINUUM_MCP_TARGETED"]==="1";
    if(!compact&&!targeted){
    this.server.tool("continuum_search_context","Search current repository context with evidence.",searchSchema,async args=>{try{const s=await this.scopedEngine(args.path);try{return protocolResult({items:await s.engine.search(args.query)});}finally{s.close();}}catch(e){return errorResult(e);}});
    this.server.tool("continuum_get_context_packet","Build a budget-constrained context packet.",searchSchema,async args=>{try{const s=await this.scopedEngine(args.path);try{return protocolResult(await s.engine.packet(args.query));}finally{s.close();}}catch(e){return errorResult(e);}});
    this.server.tool("continuum_get_context_coverage","Analyze required and missing context coverage.",searchSchema,async args=>{try{const s=await this.scopedEngine(args.path);try{const task=s.engine.analyze(args.query),items=await s.engine.search(args.query);return protocolResult({task,coverage:s.engine.coverageFor(task,items)});}finally{s.close();}}catch(e){return errorResult(e);}});
    this.server.tool("continuum_explain_context_item","Explain a repository-scoped context item.",{item_id:z.string().uuid(),path:z.string().optional().describe("Repository-contained path only.")},async args=>{try{const s=await this.scopedEngine(args.path);try{return protocolResult({item:s.engine.explain(args.item_id)??null});}finally{s.close();}}catch(e){return errorResult(e);}});
    this.server.tool("retrieve_context","Compatibility alias for continuum_get_context_packet.",searchSchema,async args=>{try{const s=await this.scopedEngine(args.path);try{return protocolResult(await s.engine.packet(args.query));}finally{s.close();}}catch(e){return errorResult(e);}});
    }

    const requestContextSchema={
      sessionId:z.string().uuid(),query:z.string().min(1),requestedSymbols:z.array(z.string().min(1)).optional(),requestedPaths:z.array(z.string().min(1)).optional(),requestedCoverage:z.array(coverage).optional(),
    };
    const registerRequestContext=()=>this.server.tool("continuum_request_context","Request a targeted progressive context delta.",requestContextSchema,async args=>{try{return protocolResult(await this.withSession(s=>s.request(args.sessionId,{query:args.query,requestedSymbols:args.requestedSymbols,requestedPaths:args.requestedPaths,requestedCoverage:args.requestedCoverage})));}catch(e){return errorResult(e);}});
    if(targeted){
      registerRequestContext();
      return;
    }

    this.server.tool("continuum_start_context_session","Start a repository-scoped progressive context session.",{
      task:z.string().min(1),budgetTokens:z.number().int().positive().optional(),runId:z.string().min(1).optional(),createInitialContext:z.boolean().optional(),
    },async args=>{try{return protocolResult(await this.withSession(s=>s.start({task:args.task,maximumEstimatedTokens:args.budgetTokens,runId:args.runId,createInitialContext:args.createInitialContext})),compact);}catch(e){return errorResult(e);}});
    this.server.tool("continuum_get_context_session","Get a repository-owned context session aggregate.",{sessionId:z.string().uuid()},async args=>{try{return protocolResult(await this.withSession(s=>s.status(args.sessionId)));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_get_initial_context","Get the idempotent initial context delivery.",{sessionId:z.string().uuid()},async args=>{try{return protocolResult(await this.withSession(s=>s.initialContext(args.sessionId)));}catch(e){return errorResult(e);}});
    registerRequestContext();
    const signalSchema=z.discriminatedUnion("type",[
      z.object({type:z.literal("agent-context-request"),query:z.string().min(1),requestedSymbols:z.array(z.string().min(1)).optional(),requestedPaths:z.array(z.string().min(1)).optional(),requestedCoverage:z.array(coverage).optional()}).strict(),
      z.object({type:z.literal("test-failure"),failingTests:z.array(z.string().min(1)).min(1),errorSummary:z.string().min(1),relatedPaths:z.array(z.string().min(1)).optional(),relatedSymbols:z.array(z.string().min(1)).optional()}).strict(),
      z.object({type:z.literal("missing-coverage"),categories:z.array(coverage).min(1)}).strict(),
      z.object({type:z.literal("out-of-scope-modification"),modifiedPaths:z.array(z.string().min(1)).min(1),predictedPaths:z.array(z.string().min(1)).min(1)}).strict(),
    ]);
    this.server.tool("continuum_report_context_signal","Report a strict context-control signal.",{sessionId:z.string().uuid(),signal:signalSchema},async args=>{try{
      let signal:ContextControlSignal;
      switch(args.signal.type){
        case"agent-context-request":signal={type:"agent_context_request",query:args.signal.query,requestedSymbols:args.signal.requestedSymbols,requestedPaths:args.signal.requestedPaths,requestedCoverage:args.signal.requestedCoverage};break;
        case"test-failure":signal={type:"test_failure",failingTests:args.signal.failingTests,errorSummary:args.signal.errorSummary,relatedPaths:args.signal.relatedPaths,relatedSymbols:args.signal.relatedSymbols};break;
        case"missing-coverage":signal={type:"missing_coverage",categories:args.signal.categories};break;
        case"out-of-scope-modification":signal={type:"out_of_scope_modification",modifiedPaths:args.signal.modifiedPaths,predictedPaths:args.signal.predictedPaths};break;
      }
      return protocolResult(await this.withSession(s=>s.signal(args.sessionId,signal)));
    }catch(e){return errorResult(e);}});
    this.server.tool("continuum_refresh_context_session","Refresh changed files and advance the task snapshot.",{sessionId:z.string().uuid()},async args=>{try{return protocolResult(await this.withSession(s=>s.refresh(args.sessionId)));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_checkpoint_context_session","Mark source context evicted after compaction.",{sessionId:z.string().uuid()},async args=>{try{await this.withSession(s=>s.checkpoint(args.sessionId));return protocolResult({sessionId:args.sessionId,checkpointed:true});}catch(e){return errorResult(e);}});
    this.server.tool("continuum_get_context_session_report","Get a persisted context-session report.",{sessionId:z.string().uuid()},async args=>{try{return protocolResult(await this.withSession(s=>s.report(args.sessionId)));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_plan_context_session","Get a compact context delivery plan without full context content.",{sessionId:z.string().uuid()},async args=>{try{return protocolResult(await this.withSession(s=>s.plan(args.sessionId)));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_recover_context_session","Build a compact recovery packet after compaction or restart.",{sessionId:z.string().uuid()},async args=>{try{return protocolResult(await this.withSession(s=>s.recover(args.sessionId)));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_recover_task_memory","Recover active original requirements and evidence-backed task state within a rendered budget.",{sessionId:z.string().uuid(),budgetTokens:z.number().int().positive().max(32000).optional()},async args=>{try{return protocolResult(await this.withSession(s=>s.memory.recover(args.sessionId,args.budgetTokens)));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_retrieve_task_evidence","Retrieve original requirements, decisions, failures or source evidence by ID, kind or text fragment.",{sessionId:z.string().uuid(),query:z.string().min(1).max(1000),budgetTokens:z.number().int().positive().max(32000).optional()},async args=>{try{return protocolResult(await this.withSession(s=>s.memory.retrieve(args.sessionId,args.query,args.budgetTokens)));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_record_task_memory","Record agent-reported progress, decisions or next actions; this does not verify tests or replace user requirements.",{sessionId:z.string().uuid(),kind:z.enum(["decision","completed","pending","question","failure","next_action"]),text:z.string().min(1).max(128000),supersedes:z.string().uuid().optional()},async args=>{try{return protocolResult(await this.withSession(async s=>s.memory.write(args.sessionId,{kind:args.kind,text:args.text,authority:"agent_reported",supersedes:args.supersedes})));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_complete_context_session","Complete a context session.",{sessionId:z.string().uuid(),status:finalStatus},async args=>{try{return protocolResult(await this.withSession(s=>s.complete(args.sessionId,{status:args.status})));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_list_context_sessions","List sessions for the configured repository only.",{status:sessionStatus.optional(),limit:z.number().int().positive().max(100).optional()},async args=>{try{return protocolResult(await this.withSession(s=>s.list({status:args.status,limit:args.limit})));}catch(e){return errorResult(e);}});
  }
  async connect(transport:Parameters<McpServer["connect"]>[0]):Promise<void>{await this.server.connect(transport);}
  async start():Promise<void>{await this.server.connect(new StdioServerTransport());}
}
