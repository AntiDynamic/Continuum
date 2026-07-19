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
function protocolResult(value:unknown){return{content:[{type:"text" as const,text:JSON.stringify(value)}],structuredContent:value as Record<string,unknown>};}
const coverage=z.enum(["implementation","public_contract","tests","configuration","architecture","security_constraint","database_schema","rollback","dependency","documentation","historical_episode","repository_state"]);
const finalStatus=z.enum(["completed","failed","cancelled"]);
const sessionStatus=z.enum(["planning","active","checkpointed","completed","failed","cancelled"]);
const errorResult=(error:unknown)=>protocolResult({error:error instanceof Error?error.message:String(error)});

export class ContinuumMcpServer {
  private readonly server=new McpServer({name:"Continuum",version:"0.3.0"});
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
    this.server.tool("continuum_search_context","Search current repository context with evidence.",searchSchema,async args=>{try{const s=await this.scopedEngine(args.path);try{return protocolResult({items:await s.engine.search(args.query)});}finally{s.close();}}catch(e){return errorResult(e);}});
    this.server.tool("continuum_get_context_packet","Build a budget-constrained context packet.",searchSchema,async args=>{try{const s=await this.scopedEngine(args.path);try{return protocolResult(await s.engine.packet(args.query));}finally{s.close();}}catch(e){return errorResult(e);}});
    this.server.tool("continuum_get_context_coverage","Analyze required and missing context coverage.",searchSchema,async args=>{try{const s=await this.scopedEngine(args.path);try{const task=s.engine.analyze(args.query),items=await s.engine.search(args.query);return protocolResult({task,coverage:s.engine.coverageFor(task,items)});}finally{s.close();}}catch(e){return errorResult(e);}});
    this.server.tool("continuum_explain_context_item","Explain a repository-scoped context item.",{item_id:z.string().uuid(),path:z.string().optional().describe("Repository-contained path only.")},async args=>{try{const s=await this.scopedEngine(args.path);try{return protocolResult({item:s.engine.explain(args.item_id)??null});}finally{s.close();}}catch(e){return errorResult(e);}});
    this.server.tool("retrieve_context","Compatibility alias for continuum_get_context_packet.",searchSchema,async args=>{try{const s=await this.scopedEngine(args.path);try{return protocolResult(await s.engine.packet(args.query));}finally{s.close();}}catch(e){return errorResult(e);}});

    this.server.tool("continuum_start_context_session","Start a repository-scoped progressive context session.",{
      task:z.string().min(1),budgetTokens:z.number().int().positive().optional(),runId:z.string().min(1).optional(),createInitialContext:z.boolean().optional(),
    },async args=>{try{return protocolResult(await this.withSession(s=>s.start({task:args.task,maximumEstimatedTokens:args.budgetTokens,runId:args.runId,createInitialContext:args.createInitialContext})));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_get_context_session","Get a repository-owned context session aggregate.",{sessionId:z.string().uuid()},async args=>{try{return protocolResult(await this.withSession(s=>s.status(args.sessionId)));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_get_initial_context","Get the idempotent initial context delivery.",{sessionId:z.string().uuid()},async args=>{try{return protocolResult(await this.withSession(s=>s.initialContext(args.sessionId)));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_request_context","Request a progressive context delta.",{
      sessionId:z.string().uuid(),query:z.string().min(1),requestedSymbols:z.array(z.string().min(1)).optional(),requestedPaths:z.array(z.string().min(1)).optional(),requestedCoverage:z.array(coverage).optional(),
    },async args=>{try{return protocolResult(await this.withSession(s=>s.request(args.sessionId,{query:args.query,requestedSymbols:args.requestedSymbols,requestedPaths:args.requestedPaths,requestedCoverage:args.requestedCoverage})));}catch(e){return errorResult(e);}});
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
    this.server.tool("continuum_get_context_session_report","Get a persisted context-session report.",{sessionId:z.string().uuid()},async args=>{try{return protocolResult(await this.withSession(s=>s.report(args.sessionId)));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_complete_context_session","Complete a context session.",{sessionId:z.string().uuid(),status:finalStatus},async args=>{try{return protocolResult(await this.withSession(s=>s.complete(args.sessionId,{status:args.status})));}catch(e){return errorResult(e);}});
    this.server.tool("continuum_list_context_sessions","List sessions for the configured repository only.",{status:sessionStatus.optional(),limit:z.number().int().positive().max(100).optional()},async args=>{try{return protocolResult(await this.withSession(s=>s.list({status:args.status,limit:args.limit})));}catch(e){return errorResult(e);}});
  }
  async connect(transport:Parameters<McpServer["connect"]>[0]):Promise<void>{await this.server.connect(transport);}
  async start():Promise<void>{await this.server.connect(new StdioServerTransport());}
}
