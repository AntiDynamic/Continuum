import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ContextSessionRepository, RepositoryRepository, migrate, openDatabase,
  type ContextSessionDeliveryItemRow, type ContextSessionDeliveryRow,
  type ContextSessionRow, type Db, type RepositoryRow,
} from "@continuum/database";
import { getRepositoryRoot } from "@continuum/git-analyzer";
import {
  CONTEXT_SESSION_REPORT_SCHEMA_VERSION, CONTEXT_SESSION_SCHEMA_VERSION,
  type AgentContextRequest, type ContextCandidate, type ContextControlDecision,
  type ContextControlSignal, type ContextCoverageCategory, type ContextItemVersion,
  type ContextPacketItem, type ContextPacketOmission, type ContextReference,
  type ContextSession, type ContextSessionAggregate, type ContextSessionListResult,
  type ContextSessionReport, type ContextSessionResult, type DeltaContextPacket,
  type IndexSnapshotIdentity, type StartContextSessionInput, type StartContextSessionResult,
} from "@continuum/shared";
import { DeterministicAdaptiveContextController } from "./controller.js";

export class ContextSessionNotInitializedError extends Error {}
export class ContextSessionRepositoryMismatchError extends Error {
  constructor(public readonly sessionId: string) { super("The requested session belongs to another repository."); }
}
export interface ContextSessionService {
  start(input: StartContextSessionInput): Promise<StartContextSessionResult>;
  status(sessionId: string): Promise<ContextSessionAggregate>;
  initialContext(sessionId: string): Promise<DeltaContextPacket>;
  request(sessionId: string, request: AgentContextRequest): Promise<DeltaContextPacket>;
  signal(sessionId: string, signal: ContextControlSignal): Promise<DeltaContextPacket | ContextControlDecision>;
  complete(sessionId: string, result: ContextSessionResult): Promise<ContextSession>;
  report(sessionId: string): Promise<ContextSessionReport>;
  list(options?: { status?: ContextSession["status"]; limit?: number }): Promise<ContextSessionListResult>;
  close(): void;
}
const snapshotFrom=(r:ContextSessionRow):IndexSnapshotIdentity=>({snapshot_kind:r.snapshot_kind,base_commit_hash:r.base_commit_hash,worktree_hash:r.worktree_hash,dirty:r.snapshot_kind==="worktree"});
const domainFrom=(r:ContextSessionRow):ContextSession=>({id:r.id,repositoryId:r.repository_id,...(r.run_id?{runId:r.run_id}:{}),task:JSON.parse(r.task_analysis_json) as ContextSession["task"],snapshot:snapshotFrom(r),strategyId:r.strategy_id,strategyVersion:r.strategy_version,status:r.status,maximumEstimatedTokens:r.maximum_estimated_tokens,deliveredEstimatedTokens:r.delivered_estimated_tokens,activeEstimatedTokens:r.active_estimated_tokens,remainingEstimatedTokens:r.remaining_estimated_tokens,createdAt:r.created_at,updatedAt:r.updated_at,...(r.completed_at?{completedAt:r.completed_at}:{})});
const parseArray=<T>(v:string):T[]=>{const p=JSON.parse(v) as unknown;return Array.isArray(p)?p as T[]:[];};
const zeroComponents:ContextCandidate["components"]={exactSymbol:0,exactTitle:0,exactPath:0,lexical:0,contextualHeader:0,dependencyRelation:0,testRelation:0,architectureRelation:0,configurationRelation:0,priorEpisodeRelation:0,taskClassRelevance:0,riskCoverage:0,currentSnapshot:0,uncommittedPenalty:0,stalenessPenalty:0,historicalPenalty:0,tokenCostPenalty:0,duplicatePenalty:0};

export class RepositoryContextSessionService implements ContextSessionService {
  private readonly sessions:ContextSessionRepository;
  private readonly controller:DeterministicAdaptiveContextController;
  private constructor(private readonly db:Db,readonly repositoryRoot:string,readonly repository:RepositoryRow){this.sessions=new ContextSessionRepository(db);this.controller=new DeterministicAdaptiveContextController(db);}
  static async open(cwd:string,requestedRepository?:string):Promise<RepositoryContextSessionService>{
    const target=resolve(cwd,requestedRepository??".");
    const repositoryRoot=await getRepositoryRoot(target);
    const dir=join(repositoryRoot,".continuum"),dbPath=join(dir,"continuum.db");
    if(!existsSync(join(dir,"config.json"))||!existsSync(dbPath))throw new ContextSessionNotInitializedError("Continuum is not initialised at "+repositoryRoot+". Run 'continuum init' first.");
    const db=openDatabase(dbPath);migrate(db);
    const repository=new RepositoryRepository(db).findByPath(repositoryRoot);
    if(!repository){db.close();throw new ContextSessionNotInitializedError("Repository is initialized but not indexed. Run 'continuum index' first.");}
    return new RepositoryContextSessionService(db,repositoryRoot,repository);
  }
  close():void{this.db.close();}
  private ownedRow(id:string):ContextSessionRow{const row=this.sessions.findRequired(id);if(row.repository_id!==this.repository.id)throw new ContextSessionRepositoryMismatchError(id);return row;}
  private version(id:string):ContextItemVersion{const row=this.db.prepare("SELECT * FROM context_item_versions WHERE id=?").get(id) as ContextItemVersion|undefined;if(!row)throw new Error("Context item version not found: "+id);return row;}
  private packetItem(row:ContextSessionDeliveryItemRow,coverage:ContextCoverageCategory[],sessionId:string):ContextPacketItem{
    const item=this.version(row.context_item_version_id);
    const provenance=item.provenance_json?JSON.parse(item.provenance_json) as ContextCandidate["provenance"]:{repositoryId:this.repository.id,sourcePath:item.source_path,sourceStartLine:item.source_start_line,sourceEndLine:item.source_end_line,extractor:"persisted",snapshot:snapshotFrom(this.ownedRow(sessionId)),confidence:"high"} as ContextCandidate["provenance"];
    return{candidate:{item,score:0,components:zeroComponents,reasons:["Reconstructed from persisted delivery evidence."],coverageCategories:coverage,estimatedTokens:row.estimated_tokens,provenance,lexicalEvidence:{backend:"fallback_lexical",rawScore:0,normalizedScore:0,normalizationMethod:"persisted-delivery"}},content:item.compiled_content??item.content,truncated:false};
  }
  private packetFromDelivery(d:ContextSessionDeliveryRow):DeltaContextPacket{
    const items=this.sessions.listDeliveryItems(d.id),added=parseArray<ContextCoverageCategory>(d.coverage_added_json),remaining=parseArray<ContextCoverageCategory>(d.coverage_remaining_json);
    const packetItems=(role:ContextSessionDeliveryItemRow["delivery_role"])=>items.filter(i=>i.delivery_role===role).map(i=>this.packetItem(i,added,d.session_id));
    const references:ContextReference[]=items.filter(i=>i.delivery_role==="active_reference").map(i=>{const v=this.version(i.context_item_version_id);return{contextItemVersionId:v.id,contentHash:i.content_hash,sourcePath:v.source_path,...(v.title?{title:v.title}:{}),estimatedTokens:i.estimated_tokens};});
    const omittedItems:ContextPacketOmission[]=items.filter(i=>i.delivery_role==="omitted").map(i=>{const v=this.version(i.context_item_version_id),candidate=i.omission_reason??"";const reason=(["budget","duplicate","diversity","stale","historical","low_score","oversized"].includes(candidate)?candidate:"budget") as ContextPacketOmission["reason"];return{contextItemVersionId:v.id,title:v.title??v.source_path,reason,estimatedTokens:i.estimated_tokens};});
    return{id:d.id,sessionId:d.session_id,stage:d.stage as DeltaContextPacket["stage"],newItems:packetItems("new"),activeReferences:references,restoredItems:packetItems("restored"),omittedItems,estimatedNewTokens:d.estimated_new_tokens,estimatedRestoredTokens:d.estimated_restored_tokens,estimatedDuplicateTokensAvoided:d.estimated_duplicate_tokens_avoided,coverageAdded:added,coverageRemaining:remaining,trigger:((value:unknown)=>typeof value==="string"?value:(value as {type:DeltaContextPacket["trigger"]}).type)(JSON.parse(d.trigger_json)) as DeltaContextPacket["trigger"],strategyId:d.strategy_id,strategyVersion:d.strategy_version,decisionReasons:[d.reason],incomplete:remaining.length>0};
  }
  async start(input:StartContextSessionInput):Promise<StartContextSessionResult>{
    let runId=input.runId;
    if(runId==="latest"){const row=this.db.prepare("SELECT id FROM agent_runs WHERE repository_id=? ORDER BY started_at DESC LIMIT 1").get(this.repository.id) as {id:string}|undefined;if(!row)throw new Error("No runs found for this repository.");runId=row.id;}
    const session=await this.controller.createSession({repositoryId:this.repository.id,repositoryRoot:this.repositoryRoot,task:input.task,...(runId?{runId}:{}),...(input.maximumEstimatedTokens!==undefined?{maximumEstimatedTokens:input.maximumEstimatedTokens}:{})});
    const initialContext=input.createInitialContext?await this.controller.createInitialDelivery(session.id):undefined;
    return{schemaVersion:CONTEXT_SESSION_SCHEMA_VERSION,session:initialContext?domainFrom(this.sessions.findRequired(session.id)):session,requiredCoverage:session.task.requiredCoverage.filter(x=>x.required).map(x=>x.category),...(initialContext?{initialContext}:{})};
  }
  async status(id:string):Promise<ContextSessionAggregate>{
    const row=this.ownedRow(id),deliveries=this.sessions.listDeliveries(id),task=JSON.parse(row.task_analysis_json) as ContextSession["task"];
    const added=[...new Set(deliveries.flatMap(d=>parseArray<ContextCoverageCategory>(d.coverage_added_json)))];
    const remaining=deliveries.length?parseArray<ContextCoverageCategory>(deliveries.at(-1)!.coverage_remaining_json):task.requiredCoverage.filter(x=>x.required).map(x=>x.category);
    return{schemaVersion:CONTEXT_SESSION_SCHEMA_VERSION,session:domainFrom(row),repository:{id:this.repository.id,path:this.repositoryRoot,name:this.repository.name},deliveryCount:deliveries.length,escalationCount:deliveries.filter(d=>d.stage==="escalation").length,signalCount:this.sessions.listSignals(id).length,activeContextItemCount:this.sessions.findActiveItems(id).length,coverage:{added,remaining,complete:remaining.length===0}};
  }
  async initialContext(id:string):Promise<DeltaContextPacket>{this.ownedRow(id);const found=this.sessions.listDeliveries(id).find(d=>d.stage==="orientation");return found?this.packetFromDelivery(found):this.controller.createInitialDelivery(id);}
  async request(id:string,request:AgentContextRequest):Promise<DeltaContextPacket>{this.ownedRow(id);return this.controller.requestContext(id,request);}
  async signal(id:string,signal:ContextControlSignal):Promise<DeltaContextPacket|ContextControlDecision>{this.ownedRow(id);return this.controller.reportSignal(id,signal);}
  async complete(id:string,result:ContextSessionResult):Promise<ContextSession>{this.ownedRow(id);return this.controller.completeSession(id,result);}
  async report(id:string):Promise<ContextSessionReport>{
    const aggregate=await this.status(id),deliveries=this.sessions.listDeliveries(id);
    const reports=deliveries.map(d=>{const items=this.sessions.listDeliveryItems(d.id),count=(r:ContextSessionDeliveryItemRow["delivery_role"])=>items.filter(i=>i.delivery_role===r).length;return{id:d.id,sequenceNumber:d.sequence_number,stage:d.stage,trigger:JSON.parse(d.trigger_json) as unknown,reason:d.reason,estimatedNewTokens:d.estimated_new_tokens,estimatedRestoredTokens:d.estimated_restored_tokens,estimatedDuplicateTokensAvoided:d.estimated_duplicate_tokens_avoided,coverageAdded:parseArray<ContextCoverageCategory>(d.coverage_added_json),coverageRemaining:parseArray<ContextCoverageCategory>(d.coverage_remaining_json),newItemCount:count("new"),activeReferenceCount:count("active_reference"),restoredItemCount:count("restored"),omittedItemCount:count("omitted"),createdAt:d.created_at};});
    const sum=(key:"newItemCount"|"activeReferenceCount"|"restoredItemCount"|"omittedItemCount")=>reports.reduce((n,r)=>n+r[key],0);
    const initial=reports.filter(r=>r.stage==="orientation").reduce((n,r)=>n+r.estimatedNewTokens+r.estimatedRestoredTokens,0),escalation=reports.filter(r=>r.stage==="escalation").reduce((n,r)=>n+r.estimatedNewTokens+r.estimatedRestoredTokens,0),duplicate=reports.reduce((n,r)=>n+r.estimatedDuplicateTokensAvoided,0);
    const providerUsageAvailable=aggregate.session.runId?Boolean(this.db.prepare("SELECT 1 ok FROM agent_usage_evidence WHERE run_id=? AND measurement!='unavailable'").get(aggregate.session.runId)):false;
    return{schemaVersion:CONTEXT_SESSION_REPORT_SCHEMA_VERSION,session:{id:aggregate.session.id,status:aggregate.session.status,task:aggregate.session.task.originalTask,taskClass:aggregate.session.task.taskClass,riskLevel:aggregate.session.task.riskLevel,strategyId:aggregate.session.strategyId,strategyVersion:aggregate.session.strategyVersion},snapshot:aggregate.session.snapshot,budget:{maximumEstimatedTokens:aggregate.session.maximumEstimatedTokens,deliveredEstimatedTokens:aggregate.session.deliveredEstimatedTokens,activeEstimatedTokens:aggregate.session.activeEstimatedTokens,remainingEstimatedTokens:aggregate.session.remainingEstimatedTokens},activity:{deliveryCount:reports.length,escalationCount:aggregate.escalationCount,signalCount:aggregate.signalCount,newItemCount:sum("newItemCount"),activeReferenceCount:sum("activeReferenceCount"),restoredItemCount:sum("restoredItemCount"),omittedItemCount:sum("omittedItemCount")},context:{estimatedInitialTokens:initial,estimatedEscalationTokens:escalation,estimatedDuplicateTokensAvoided:duplicate},coverage:aggregate.coverage,evidence:{tokenMeasurement:"estimated",duplicateAvoidanceMeasurement:"estimated",providerUsageAvailable},deliveries:reports,createdAt:aggregate.session.createdAt,...(aggregate.session.completedAt?{completedAt:aggregate.session.completedAt}:{})};
  }
  async list(options:{status?:ContextSession["status"];limit?:number}={}):Promise<ContextSessionListResult>{
    const limit=Math.max(1,Math.min(options.limit??20,100));
    const rows=(options.status?this.db.prepare("SELECT * FROM context_sessions WHERE repository_id=? AND status=? ORDER BY created_at DESC LIMIT ?").all(this.repository.id,options.status,limit):this.db.prepare("SELECT * FROM context_sessions WHERE repository_id=? ORDER BY created_at DESC LIMIT ?").all(this.repository.id,limit)) as unknown as ContextSessionRow[];
    return{schemaVersion:CONTEXT_SESSION_SCHEMA_VERSION,repositoryId:this.repository.id,sessions:await Promise.all(rows.map(r=>this.status(r.id)))};
  }
}
export async function withContextSessionService<T>(cwd:string,repository:string|undefined,operation:(service:RepositoryContextSessionService)=>Promise<T>):Promise<T>{const service=await RepositoryContextSessionService.open(cwd,repository);try{return await operation(service);}finally{service.close();}}
