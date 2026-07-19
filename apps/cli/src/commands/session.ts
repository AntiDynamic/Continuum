import {
  ContextSessionBudgetExceededError, ContextSessionInactiveError,
  ContextSessionInvalidBudgetError, ContextSessionNotFoundError,
  ContextSessionRunMismatchError, ContextSessionSnapshotMismatchError,
} from "@continuum/database";
import {
  ContextSessionNotInitializedError, ContextSessionRepositoryMismatchError,
  IndexedSnapshotMismatchError, withContextSessionService,
} from "@continuum/context-engine";
import type {
  ContextControlSignal, ContextCoverageCategory, ContextSession,
  ContextSessionAggregate, ContextSessionReport, DeltaContextPacket,
} from "@continuum/shared";
import { blank, bold, kv, line, section } from "../display.js";

export interface SessionBaseOptions { cwd: string; repo?: string; json?: boolean }
export interface SessionStartOptions extends SessionBaseOptions { budgetTokens?: string; run?: string; initialContext?: boolean }
export interface SessionRequestOptions extends SessionBaseOptions { symbol?: string[]; path?: string[]; coverage?: string[] }
export interface SessionSignalOptions extends SessionBaseOptions { type: string; query?: string; tests?: string[]; error?: string; path?: string[]; symbol?: string[]; coverage?: string[]; modified?: string[]; predicted?: string[] }
export interface SessionCompleteOptions extends SessionBaseOptions { status: string }
export interface SessionListOptions extends SessionBaseOptions { status?: string; limit?: string }

const coverageValues:ContextCoverageCategory[]=["implementation","public_contract","tests","configuration","architecture","security_constraint","database_schema","rollback","dependency","documentation","historical_episode","repository_state"];
const statusValues:ContextSession["status"][]=["planning","active","checkpointed","completed","failed","cancelled"];
const output=(value:unknown,json?:boolean):void=>{if(json)line(JSON.stringify(value,null,2));};
const fmt=(value:number):string=>value.toLocaleString("en-US");

function validateCoverage(values:string[]|undefined):ContextCoverageCategory[]|undefined{
  if(!values)return undefined;
  for(const value of values)if(!coverageValues.includes(value as ContextCoverageCategory))throw new Error("Unsupported coverage category: "+value);
  return values as ContextCoverageCategory[];
}
function actionable(error:unknown):Error{
  if(error instanceof IndexedSnapshotMismatchError||error instanceof ContextSessionSnapshotMismatchError)return new Error("Cannot start or continue the context session.\n\nThe repository state differs from the latest indexed snapshot.\n\nRun:\ncontinuum index\n\nThen start a new session.");
  if(error instanceof ContextSessionInactiveError)return new Error("Session "+error.sessionId+" is already completed.\nNo additional context can be delivered.");
  if(error instanceof ContextSessionBudgetExceededError)return new Error("Context expansion stopped.\n\nRemaining budget: "+error.remainingTokens+" estimated tokens\nRequired additional budget: approximately "+error.requestedTokens+" estimated tokens");
  if(error instanceof ContextSessionRunMismatchError)return new Error("The requested run belongs to another repository.");
  if(error instanceof ContextSessionRepositoryMismatchError)return new Error("The requested session belongs to another repository.\nRun the command from the correct repository or use --repo.");
  if(error instanceof ContextSessionInvalidBudgetError||error instanceof ContextSessionNotFoundError||error instanceof ContextSessionNotInitializedError)return error;
  return error instanceof Error?error:new Error(String(error));
}
async function use<T>(options:SessionBaseOptions,operation:(service:Awaited<ReturnType<typeof import("@continuum/context-engine")["RepositoryContextSessionService"]["open"]>>) => Promise<T>):Promise<T>{
  try{return await withContextSessionService(options.cwd,options.repo,operation);}
  catch(error){throw actionable(error);}
}
function printDelta(packet:DeltaContextPacket):void{
  line(bold("CONTINUUM CONTEXT DELIVERY"));blank();
  kv("Trigger",packet.trigger);kv("Stage",packet.stage);kv("Estimated new tokens",fmt(packet.estimatedNewTokens),"estimated");
  kv("Estimated duplicate tokens avoided",fmt(packet.estimatedDuplicateTokensAvoided),"estimated");
  section("Decision reasons");for(const reason of packet.decisionReasons)line("  "+reason);
  section("New context");
  if(packet.newItems.length===0)line("  none");
  for(const item of packet.newItems){line("  "+item.candidate.item.source_path+(item.candidate.item.symbol_name?" — "+item.candidate.item.symbol_name:""));line(item.content);}
  section("Active references");
  if(packet.activeReferences.length===0)line("  none");
  for(const item of packet.activeReferences)line("  "+item.sourcePath+" ["+item.contextItemVersionId+"]");
  section("Restored context");if(packet.restoredItems.length===0)line("  none");for(const item of packet.restoredItems)line("  "+item.candidate.item.source_path);
  section("Omitted context");if(packet.omittedItems.length===0)line("  none");for(const item of packet.omittedItems)line("  "+item.title+" — "+item.reason);
  section("Coverage");kv("Added",packet.coverageAdded.join(", ")||"none");kv("Remaining",packet.coverageRemaining.join(", ")||"none");
}
function printAggregate(a:ContextSessionAggregate):void{
  line(bold("CONTINUUM CONTEXT SESSION"));blank();section("Task");line(a.session.task.originalTask);
  section("State");kv("Session",a.session.id);kv("Repository",a.repository.path);kv("Run",a.session.runId??"not linked");kv("Status",a.session.status);kv("Strategy",a.session.strategyId+" v"+a.session.strategyVersion);kv("Snapshot",a.session.snapshot.snapshot_kind+" "+(a.session.snapshot.worktree_hash??a.session.snapshot.base_commit_hash));kv("Budget",fmt(a.session.deliveredEstimatedTokens)+" / "+fmt(a.session.maximumEstimatedTokens)+" estimated tokens");kv("Active tokens",fmt(a.session.activeEstimatedTokens));kv("Remaining tokens",fmt(a.session.remainingEstimatedTokens));kv("Deliveries",String(a.deliveryCount));kv("Escalations",String(a.escalationCount));kv("Signals",String(a.signalCount));kv("Active context items",String(a.activeContextItemCount));kv("Created",a.session.createdAt);kv("Updated",a.session.updatedAt);
  section("Coverage");kv("Added",a.coverage.added.join(", ")||"none");kv("Remaining",a.coverage.remaining.join(", ")||"none");
}
export function printSessionReport(r:ContextSessionReport):void{
  line(bold("CONTINUUM CONTEXT SESSION"));blank();section("Task");line(r.session.task);section("State");kv("Session",r.session.id);kv("Status",r.session.status);kv("Strategy",r.session.strategyId+" v"+r.session.strategyVersion);kv("Snapshot",r.snapshot.snapshot_kind+" "+(r.snapshot.worktree_hash??r.snapshot.base_commit_hash));kv("Budget",fmt(r.budget.deliveredEstimatedTokens)+" / "+fmt(r.budget.maximumEstimatedTokens)+" estimated tokens");
  section("Activity");kv("Deliveries",String(r.activity.deliveryCount));kv("Escalations",String(r.activity.escalationCount));kv("New items",String(r.activity.newItemCount));kv("Active references",String(r.activity.activeReferenceCount));kv("Estimated duplicate context avoided",fmt(r.context.estimatedDuplicateTokensAvoided),"estimated; no measured counterfactual baseline");
  section("Coverage");kv("Added",r.coverage.added.join(", ")||"none");kv("Remaining",r.coverage.remaining.join(", ")||"none");
}
export async function runSessionStart(task:string,options:SessionStartOptions):Promise<void>{
  const budget=options.budgetTokens===undefined?undefined:Number(options.budgetTokens);if(budget!==undefined&&(!Number.isInteger(budget)||budget<=0))throw new Error("--budget-tokens must be a positive integer.");
  const result=await use(options,s=>s.start({task,...(budget!==undefined?{maximumEstimatedTokens:budget}:{}),...(options.run?{runId:options.run}:{}),createInitialContext:options.initialContext}));
  if(options.json)return output(result,true);
  line(bold("Context session started"));blank();kv("Session",result.session.id);kv("Strategy",result.session.strategyId);kv("Task class",result.session.task.taskClass);kv("Risk",result.session.task.riskLevel);kv("Snapshot",result.session.snapshot.snapshot_kind);kv("Base commit",result.session.snapshot.base_commit_hash);if(result.session.snapshot.worktree_hash)kv("Worktree hash",result.session.snapshot.worktree_hash);kv("Budget",fmt(result.session.maximumEstimatedTokens)+" estimated tokens");section("Required coverage");for(const item of result.requiredCoverage)line("  ✓ "+item);kv("Initial context",result.initialContext?"delivered":"not delivered");blank();line("Run:");line("continuum session context "+result.session.id);
}
export async function runSessionStatus(id:string,options:SessionBaseOptions):Promise<void>{const result=await use(options,s=>s.status(id));if(options.json)return output(result,true);printAggregate(result);}
export async function runSessionContext(id:string,options:SessionBaseOptions):Promise<void>{const result=await use(options,s=>s.initialContext(id));if(options.json)return output({schemaVersion:"continuum.context-session.v1",sessionId:id,packet:result},true);printDelta(result);}
export async function runSessionRequest(id:string,query:string,options:SessionRequestOptions):Promise<void>{const result=await use(options,s=>s.request(id,{query,requestedSymbols:options.symbol,requestedPaths:options.path,requestedCoverage:validateCoverage(options.coverage)}));if(options.json)return output({schemaVersion:"continuum.context-session.v1",sessionId:id,packet:result},true);printDelta(result);}
export async function runSessionSignal(id:string,options:SessionSignalOptions):Promise<void>{
  let signal:ContextControlSignal;
  switch(options.type){
    case"agent-context-request":if(!options.query)throw new Error("agent-context-request requires --query.");signal={type:"agent_context_request",query:options.query,requestedSymbols:options.symbol,requestedPaths:options.path,requestedCoverage:validateCoverage(options.coverage)};break;
    case"test-failure":if(!options.tests?.length||!options.error)throw new Error("test-failure requires --tests and --error.");signal={type:"test_failure",failingTests:options.tests,errorSummary:options.error,relatedPaths:options.path,relatedSymbols:options.symbol};break;
    case"missing-coverage":{const categories=validateCoverage(options.coverage);if(!categories?.length)throw new Error("missing-coverage requires --coverage.");signal={type:"missing_coverage",categories};break;}
    case"out-of-scope-modification":if(!options.modified?.length||!options.predicted?.length)throw new Error("out-of-scope-modification requires --modified and --predicted.");signal={type:"out_of_scope_modification",modifiedPaths:options.modified,predictedPaths:options.predicted};break;
    default:throw new Error("Unsupported signal type: "+options.type);
  }
  const result=await use(options,s=>s.signal(id,signal));if(options.json)return output({schemaVersion:"continuum.context-session.v1",sessionId:id,result},true);if("newItems"in result)printDelta(result);else{line(bold("Context control decision"));for(const reason of result.reasons)line("  "+reason);}
}
export async function runSessionReport(id:string,options:SessionBaseOptions):Promise<void>{const result=await use(options,s=>s.report(id));if(options.json)return output(result,true);printSessionReport(result);}
export async function runSessionComplete(id:string,options:SessionCompleteOptions):Promise<void>{if(!["completed","failed","cancelled"].includes(options.status))throw new Error("--status must be completed, failed, or cancelled.");const session=await use(options,s=>s.complete(id,{status:options.status as "completed"|"failed"|"cancelled"}));const report=await use(options,s=>s.report(id));const result={schemaVersion:"continuum.context-session.v1",sessionId:id,status:session.status,completedAt:session.completedAt,totalEstimatedContextTokens:session.deliveredEstimatedTokens,deliveries:report.activity.deliveryCount,escalations:report.activity.escalationCount,activeItemsExpired:report.budget.activeEstimatedTokens===0,coverageRemaining:report.coverage.remaining};if(options.json)return output(result,true);line(bold("Context session completed"));for(const [key,value]of Object.entries(result).filter(([k])=>k!=="schemaVersion"))kv(key,Array.isArray(value)?value.join(", ")||"none":String(value));}
export async function runSessionList(options:SessionListOptions):Promise<void>{if(options.status&&!statusValues.includes(options.status as ContextSession["status"]))throw new Error("Unsupported session status: "+options.status);const limit=options.limit===undefined?undefined:Number(options.limit);if(limit!==undefined&&(!Number.isInteger(limit)||limit<=0))throw new Error("--limit must be a positive integer.");const result=await use(options,s=>s.list({...(options.status?{status:options.status as ContextSession["status"]}:{}),...(limit?{limit}:{})}));if(options.json)return output(result,true);line(bold("CONTINUUM CONTEXT SESSIONS"));for(const item of result.sessions){blank();kv("Session",item.session.id);kv("Status",item.session.status);kv("Task",item.session.task.originalTask);kv("Budget",fmt(item.session.deliveredEstimatedTokens)+" / "+fmt(item.session.maximumEstimatedTokens));}}
