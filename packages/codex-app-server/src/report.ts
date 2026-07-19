import { relative, resolve } from "node:path";
import type { Db, CodexExecutionRow } from "@continuum/database";
import { CodexExecutionRepository } from "@continuum/database";

export const SHADOW_REPORT_SCHEMA_VERSION="continuum.shadow-flight-recorder.v1" as const;
const parse=(value:string):any=>{try{return JSON.parse(value)}catch{return{}}};
const slash=(value:string):string=>value.replaceAll("\\","/").replace(/^\.\//,"");

export interface ShadowFlightRecorderReport {
  schemaVersion:typeof SHADOW_REPORT_SCHEMA_VERSION;
  execution:{executionId:string;sessionId:string;repositoryId:string;task:string;snapshot:{snapshot_kind:string;base_commit_hash:string;worktree_hash:string|null;dirty:boolean};codexVersion:string;model:string|null;status:string;durationMs:number};
  prediction:{estimatedTokens:number;items:Array<{id:string;path:string;symbol:string|null;mandatory:boolean;estimatedTokens:number}>;mandatoryCoverage:unknown[]};
  exploration:{directlyObservedPaths:string[];inferredPaths:string[];searchedSymbols:string[];commands:unknown[];tests:unknown[];changedPaths:string[]};
  comparison:{predictedAndObserved:unknown[];predictedNotObserved:unknown[];observedNotPredicted:unknown[];mandatoryPredictionMisses:unknown[];overlapRecall:number|null;overlapPrecision:number|null};
  usage:{accumulated:unknown|null;exactResponses:unknown[];availability:"measured"|"partial"|"unavailable"};
  outcome:{turnStatus:string;testsObserved:boolean;testsPassed:boolean|null;diffCaptured:boolean;changedFileCount:number};
  evidenceWarnings:string[];
}

function duration(row:CodexExecutionRow):number{return Math.max(0,new Date(row.completed_at??new Date().toISOString()).getTime()-new Date(row.started_at).getTime());}
export function buildShadowReport(db:Db,executionId:string,repositoryRoot:string):ShadowFlightRecorderReport{
  const repository=new CodexExecutionRepository(db);const execution=repository.findRequired(executionId);const events=repository.listNormalized(executionId);const usage=repository.listUsage(executionId);const diff=repository.latestDiff(executionId);
  const session=db.prepare("SELECT task_analysis_json FROM context_sessions WHERE id=?").get(execution.session_id) as {task_analysis_json:string};const analysis=parse(session.task_analysis_json);
  const predicted=db.prepare(`SELECT v.id,v.source_path,v.symbol_name,i.estimated_tokens,i.delivery_role FROM context_session_delivery_items i JOIN context_session_deliveries d ON d.id=i.delivery_id JOIN context_item_versions v ON v.id=i.context_item_version_id WHERE d.session_id=? AND d.stage='orientation' AND i.delivery_role IN('new','restored') ORDER BY d.sequence_number,i.rowid`).all(execution.session_id) as Array<{id:string;source_path:string;symbol_name:string|null;estimated_tokens:number;delivery_role:string}>;
  const payloads=events.map((event:any)=>({...event,payload:parse(event.payload_json)}));
  const commands=payloads.filter((event:any)=>event.event_type==="command_execution").map((event:any)=>({...event.payload,sourceEventSequence:event.raw_sequence_number,evidenceType:event.evidence_type,confidence:event.confidence}));
  const tests=payloads.filter((event:any)=>event.event_type==="test_execution").map((event:any)=>({...event.payload,sourceEventSequence:event.raw_sequence_number,evidenceType:event.evidence_type,confidence:event.confidence}));
  const direct=[...new Set(payloads.filter((event:any)=>event.event_type==="file_edit").flatMap((event:any)=>(event.payload.changes??[]).map((change:any)=>slash(String(change.path)))))];
  const inferred=[...new Set(payloads.filter((event:any)=>event.event_type==="file_read_evidence"||event.event_type==="repository_search").map((event:any)=>slash(String(event.payload.path))))];
  const observed=[...new Set([...direct,...inferred])];const predictedPaths=[...new Set(predicted.map((item)=>slash(item.source_path)))];
  const overlap=predictedPaths.filter((path)=>observed.includes(path));const predictedItems=predicted.map((item)=>({id:item.id,path:slash(item.source_path),symbol:item.symbol_name,mandatory:true,estimatedTokens:item.estimated_tokens}));
  const comparisonItem=(path:string)=>({path,evidence:direct.includes(path)?"directly observed":"command-inferred"});
  const accumulated=usage.filter((row:any)=>row.accumulation==="accumulated").at(-1)??null;const exact=usage.filter((row:any)=>row.accumulation==="per_response");
  const testsPassed=tests.length?tests.every((test:any)=>test.status==="passed"):null;
  const warnings=["Shadow mode did not restrict Codex or inject Continuum prediction content.","Command-inferred paths are not proof that a file was read.","Observed-not-predicted paths are additional exploration, not automatically unnecessary.","Continuum packet tokens are estimated; no token-savings claim is made."];
  if(execution.repository_changed)warnings.push("Repository state changed during execution; external concurrent changes cannot be excluded from App Server evidence alone.");
  return{schemaVersion:SHADOW_REPORT_SCHEMA_VERSION,execution:{executionId,sessionId:execution.session_id,repositoryId:String(execution.repository_id),task:execution.task_text,snapshot:{snapshot_kind:execution.worktree_hash?"worktree":"commit",base_commit_hash:execution.base_commit_hash,worktree_hash:execution.worktree_hash,dirty:Boolean(execution.worktree_hash)},codexVersion:execution.codex_version,model:execution.model,status:execution.status,durationMs:duration(execution)},prediction:{estimatedTokens:predicted.reduce((sum,item)=>sum+item.estimated_tokens,0),items:predictedItems,mandatoryCoverage:analysis.requiredCoverage??[]},exploration:{directlyObservedPaths:direct,inferredPaths:inferred,searchedSymbols:[],commands,tests,changedPaths:direct},comparison:{predictedAndObserved:overlap.map(comparisonItem),predictedNotObserved:predictedPaths.filter((path)=>!observed.includes(path)).map((path)=>({path,evidence:"prediction"})),observedNotPredicted:observed.filter((path)=>!predictedPaths.includes(path)).map(comparisonItem),mandatoryPredictionMisses:predictedItems.filter((item)=>item.mandatory&&!observed.includes(item.path)),overlapRecall:observed.length?overlap.length/observed.length:null,overlapPrecision:predictedPaths.length?overlap.length/predictedPaths.length:null},usage:{accumulated,exactResponses:exact,availability:accumulated?exact.length?"partial":"measured":exact.length?"partial":"unavailable"},outcome:{turnStatus:execution.status,testsObserved:tests.length>0,testsPassed,diffCaptured:Boolean(diff),changedFileCount:direct.length},evidenceWarnings:warnings};
}
