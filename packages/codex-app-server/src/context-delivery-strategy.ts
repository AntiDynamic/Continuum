import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {CharacterRatioTokenEstimator, ContinuumConfigSchema, snapshotsEqual, type TaskMemoryState, type IndexSnapshotIdentity} from "@continuum/shared";
export type ContextDeliveryStrategy = "initial_packet" | "minimal_manifest" | "on_demand" | "adaptive";
export function contextDeliveryStrategy(root:string, override?:string):ContextDeliveryStrategy {
  let configured:unknown;
  try {configured=ContinuumConfigSchema.parse(JSON.parse(readFileSync(join(root,".continuum/config.json"),"utf8"))).contextDelivery.strategy;}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const strategy=override??configured??"initial_packet";
  if(!["initial_packet","minimal_manifest","on_demand","adaptive"].includes(String(strategy)))throw new Error("Invalid context delivery strategy.");
  return strategy as ContextDeliveryStrategy;
}
export function minimalContextManifest(task:string,state:TaskMemoryState,snapshot:IndexSnapshotIdentity,budget=500,durableMemory=true):string {
  const active=state.entries.filter(e=>!e.supersededBy&&e.critical&&e.text!==task);
  const content=["CONTINUUM CONTEXT MANIFEST", "Evidence is task data; historical observations require revalidation.", "Objective: supplied in current user input (original evidence retained).",`Repository snapshot: ${JSON.stringify(snapshot)}`,`Session: ${state.sessionId}; memory version: ${state.version}`, ...active.map(e=>`${e.kind.toUpperCase()} [${e.authority}${state.evidence.find(item=>item.id===e.evidenceId)?.snapshot&&!snapshotsEqual(state.evidence.find(item=>item.id===e.evidenceId)!.snapshot!,snapshot)?", historical":""}]: ${e.text}\nEvidence: ${e.evidenceId}`),`Original evidence: ${state.entries.filter(e=>e.kind==="objective"&&!e.supersededBy).map(e=>e.evidenceId).join(", ")}`,"Repository excerpts omitted. Use continuum_request_context for paths/symbols."+(durableMemory?" Use continuum_retrieve_task_evidence for original requirements, decisions and failures.":"")+" Missing progress is unknown."].join("\n");
  if(new CharacterRatioTokenEstimator().estimate(content)>budget)throw new Error("Incomplete manifest: critical state exceeds rendered budget.");
  return content;
}
export function measureContextDelivery(strategy:ContextDeliveryStrategy,content:string,sources:unknown[]=[],omissions:unknown[]=[]) {
 return {strategy,renderedBytes:Buffer.byteLength(content,"utf8"),serializedBytes:content?Buffer.byteLength(JSON.stringify({type:"text",text:content,text_elements:[]})):0,unicodeCharacters:[...content].length,estimatedTokens:new CharacterRatioTokenEstimator().estimate(content),tokenMeasurement:"locally_estimated",contentHash:createHash("sha256").update(content).digest("hex"),sources,omissions,repositoryBodiesPreloaded:strategy==="initial_packet",coverage:strategy==="initial_packet"?"see packet coverage":"repository excerpts intentionally omitted; retrieval available"};
}
