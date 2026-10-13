import { createHash } from "node:crypto";
import { CharacterRatioTokenEstimator, renderContextDelivery } from "@continuum/shared";
import type { ContextSessionRepository } from "@continuum/database";
import type { ContextCacheDelivery, ContextCandidate, ContextCoverageCategory, ContextDeliveryTrigger, ContextPacketItem, ContextPacketOmission, ContextReference, ContextSession, DeltaContextPacket, IndexSnapshotIdentity } from "@continuum/shared";
import { DEFAULT_ESCALATION_LIMITS, STRATEGY_ID, STRATEGY_VERSION } from "./escalation-policy.js";

export interface DeltaPacketBuildOptions { stage: "orientation" | "implementation" | "escalation"; trigger: ContextDeliveryTrigger; reason: string; reasons: string[]; currentSnapshot: IndexSnapshotIdentity; maximumEstimatedTokens?: number; maximumItems?: number; mandatoryCoverage?: ContextCoverageCategory[]; signalId?: string; minimumCandidateScore?: number; cacheDelivery?: ContextCacheDelivery; }
export interface DeltaPacketBuilder { build(session: ContextSession,candidates:ContextCandidate[],options:DeltaPacketBuildOptions):Promise<DeltaContextPacket>; }

/** Requirement state priority for deriving item-level state from coverage categories */
type RequirementState = "required" | "recommended" | "optional" | "not_applicable" | "unavailable" | "unknown_legacy";

function deriveRequirementState(coverageCategories: ContextCoverageCategory[], requiredCoverage: Array<{category:string;state:string;required:boolean}>): RequirementState {
  let best: RequirementState = "not_applicable";
  for (const category of coverageCategories) {
    const entry = requiredCoverage.find(e => e.category === category);
    if (!entry) continue;
    const state = entry.state as RequirementState;
    if (state === "required") return "required";
    if (state === "recommended") best = "recommended";
    else if (state === "optional" && best === "not_applicable") best = "optional";
    else if (state === "unavailable" && best === "not_applicable") best = "unavailable";
  }
  return best;
}

/** Derive packet section from candidate properties (mirrors engine.ts section logic) */
function derivePacketSection(candidate: ContextCandidate, mandatoryCoverage: Set<ContextCoverageCategory>): string {
  const exactScore = (candidate.components.exactSymbol ?? 0) + (candidate.components.exactTitle ?? 0) + (candidate.components.exactPath ?? 0);
  if (exactScore > 0 && !candidate.coverageCategories.includes("tests")) return "exact_implementation";
  if (candidate.coverageCategories.includes("security_constraint")) return "mandatory_contracts_constraints";
  if (candidate.coverageCategories.some(c => mandatoryCoverage.has(c) && c !== "tests")) return "mandatory_contracts_constraints";
  if (candidate.coverageCategories.includes("tests")) return "directly_related_tests";
  if (candidate.coverageCategories.some(c => ["architecture","documentation","repository_state"].includes(c)) && candidate.score >= 3) return "orientation";
  return "optional_context";
}

/** Extract single-category reasons from the full reasons array */
function extractExactMatchReason(reasons: string[]): string | null {
  return reasons.find(r => r.startsWith("Exact normalized symbol match:") || r.startsWith("Exact title match:") || r.startsWith("Exact path match:")) ?? null;
}
function extractRelationshipReason(reasons: string[]): string | null {
  return reasons.find(r => r.startsWith("Expanded through") || r.startsWith("Source path matches")) ?? null;
}
function extractCoverageReason(reasons: string[]): string | null {
  return reasons.find(r => r.startsWith("Required coverage:") || r.startsWith("Added to complete")) ?? null;
}

export class DeterministicDeltaPacketBuilder implements DeltaPacketBuilder {
 constructor(private readonly sessions:ContextSessionRepository){}
 async build(session:ContextSession,candidates:ContextCandidate[],options:DeltaPacketBuildOptions):Promise<DeltaContextPacket>{
  const active=this.sessions.findActiveItems(session.id),byVersion=new Map(active.map(item=>[item.context_item_version_id,item])),byHash=new Map(active.map(item=>[item.content_hash,item]));
  const newItems:ContextPacketItem[]=[],activeReferences:ContextReference[]=[],omittedItems:ContextPacketOmission[]=[];const deliveryItems:any[]=[];let estimatedNewTokens=0,estimatedDuplicateTokensAvoided=0;
  const maxTokens=Math.min(options.maximumEstimatedTokens??DEFAULT_ESCALATION_LIMITS.maximumEstimatedTokensPerEscalation,session.remainingEstimatedTokens),maxItems=options.maximumItems??DEFAULT_ESCALATION_LIMITS.maximumItemsPerEscalation,mandatory=new Set(options.mandatoryCoverage??[]),covered=new Set<ContextCoverageCategory>();let additional=0;
  const requiredCoverage = (session.task as any).requiredCoverage ?? [];
  const mandatorySet = new Set<ContextCoverageCategory>(options.mandatoryCoverage ?? []);
  for(const candidate of candidates){const item=candidate.item;const duplicate=byVersion.get(item.id)??byHash.get(item.content_hash);if(duplicate){activeReferences.push({contextItemVersionId:item.id,contentHash:item.content_hash,sourcePath:item.source_path,title:item.title??undefined,estimatedTokens:candidate.estimatedTokens});estimatedDuplicateTokensAvoided+=candidate.estimatedTokens;deliveryItems.push({contextItemVersionId:item.id,role:"active_reference",estimatedTokens:candidate.estimatedTokens,contentHash:item.content_hash,presenceState:"active",duplicateOfDeliveryId:duplicate.delivery_id,requirementState:deriveRequirementState(candidate.coverageCategories,requiredCoverage),coverageCategories:candidate.coverageCategories,packetSection:derivePacketSection(candidate,mandatorySet),selectionReasons:candidate.reasons,exactMatchReason:extractExactMatchReason(candidate.reasons),relationshipReason:extractRelationshipReason(candidate.reasons),coverageReason:extractCoverageReason(candidate.reasons)});for(const category of candidate.coverageCategories)covered.add(category);continue;}if(item.valid_to_commit_exclusive!==null||item.staleness_status==="stale"){omittedItems.push({contextItemVersionId:item.id,title:item.title??item.id,reason:item.valid_to_commit_exclusive!==null?"historical":"stale",estimatedTokens:candidate.estimatedTokens});continue;}if(candidate.score<(options.minimumCandidateScore??0)&&!candidate.coverageCategories.some(category=>mandatory.has(category))){omittedItems.push({contextItemVersionId:item.id,title:item.title??item.id,reason:"low_score",estimatedTokens:candidate.estimatedTokens});continue;}const required=candidate.coverageCategories.some(category=>mandatory.has(category)&&!covered.has(category));if(newItems.length>=maxItems||estimatedNewTokens+candidate.estimatedTokens>maxTokens){omittedItems.push({contextItemVersionId:item.id,title:item.title??item.id,reason:"budget",estimatedTokens:candidate.estimatedTokens});if(required)additional=Math.max(additional,candidate.estimatedTokens-(maxTokens-estimatedNewTokens));continue;}newItems.push({candidate,content:item.compiled_content??item.content,truncated:false});deliveryItems.push({contextItemVersionId:item.id,role:"new",estimatedTokens:candidate.estimatedTokens,contentHash:item.content_hash,presenceState:"active",requirementState:deriveRequirementState(candidate.coverageCategories,requiredCoverage),coverageCategories:candidate.coverageCategories,packetSection:derivePacketSection(candidate,mandatorySet),selectionReasons:candidate.reasons,exactMatchReason:extractExactMatchReason(candidate.reasons),relationshipReason:extractRelationshipReason(candidate.reasons),coverageReason:extractCoverageReason(candidate.reasons)});estimatedNewTokens+=candidate.estimatedTokens;for(const category of candidate.coverageCategories)covered.add(category);}
  for (const item of active) for (const category of JSON.parse(item.coverage_categories_json)) covered.add(category);
  const required=session.task.requiredCoverage.filter(entry=>entry.required).map(entry=>entry.category),coverageRemaining=required.filter(category=>!covered.has(category)&&!active.some(item=>candidates.some(c=>c.item.id===item.context_item_version_id&&c.coverageCategories.includes(category))));const packet:DeltaContextPacket={id:crypto.randomUUID(),sessionId:session.id,stage:options.stage,newItems,activeReferences,restoredItems:[],omittedItems,estimatedNewTokens,estimatedRestoredTokens:0,estimatedDuplicateTokensAvoided,coverageAdded:[...covered],coverageRemaining,trigger:options.trigger,strategyId:STRATEGY_ID,strategyVersion:STRATEGY_VERSION,decisionReasons:options.reasons,incomplete:coverageRemaining.length>0,...(options.cacheDelivery?{cacheDelivery:options.cacheDelivery}:{}),...(additional>0?{additionalEstimatedTokensRequired:additional}:{})};
  const estimator = new CharacterRatioTokenEstimator();
  // Reserve the full serialized envelope, then discard lowest-priority source items.
  let rendered = renderContextDelivery(packet);
  while (estimator.estimate(rendered) > maxTokens && packet.newItems.length) {
    const removed = packet.newItems.pop()!;
    packet.omittedItems.push({contextItemVersionId:removed.candidate.item.id,title:removed.candidate.item.title??removed.candidate.item.source_path,reason:"budget",estimatedTokens:removed.candidate.estimatedTokens});
    const at = deliveryItems.findIndex(item => item.contextItemVersionId === removed.candidate.item.id && item.role === "new");
    if (at >= 0) deliveryItems.splice(at,1);
    const acquired = new Set([...packet.newItems,...packet.restoredItems].flatMap(item=>item.candidate.coverageCategories));
    for (const item of active) for (const category of JSON.parse(item.coverage_categories_json)) acquired.add(category);
    packet.coverageAdded = [...acquired];
    packet.coverageRemaining = required.filter(category=>!acquired.has(category));
    packet.incomplete = packet.coverageRemaining.length > 0;
    rendered = renderContextDelivery(packet);
  }
  if (estimator.estimate(rendered) > maxTokens && packet.cacheDelivery) {
    packet.cacheDelivery = undefined;
    rendered = renderContextDelivery(packet);
  }
  if (estimator.estimate(rendered) > maxTokens) throw new Error(`Context budget too small for the delivery envelope: need ${estimator.estimate(rendered)} estimated tokens, available ${maxTokens}.`);
  for (const omitted of packet.omittedItems) {
    const candidate = candidates.find(item=>item.item.id===omitted.contextItemVersionId);
    if (candidate) deliveryItems.push({contextItemVersionId:omitted.contextItemVersionId,role:"omitted",estimatedTokens:omitted.estimatedTokens,contentHash:candidate.item.content_hash,presenceState:"unknown",omissionReason:omitted.reason,coverageCategories:candidate.coverageCategories});
  }
  const previouslyEvicted = new Set(this.sessions.listDeliveries(session.id).flatMap(delivery=>this.sessions.listDeliveryItems(delivery.id)).filter(item=>item.presence_state==="checkpointed").map(item=>item.context_item_version_id));
  packet.restoredItems = packet.newItems.filter(item=>previouslyEvicted.has(item.candidate.item.id));
  packet.newItems = packet.newItems.filter(item=>!previouslyEvicted.has(item.candidate.item.id));
  for(const item of deliveryItems)if(item.role==="new"&&previouslyEvicted.has(item.contextItemVersionId))item.role="restored";
  rendered = renderContextDelivery(packet);
  packet.estimatedRestoredTokens = packet.restoredItems.reduce((sum,item)=>sum+estimator.estimate(item.candidate.item.content),0);
  packet.renderedContent = rendered;
  packet.renderedContentHash = createHash("sha256").update(rendered).digest("hex");
  packet.renderedEstimatedTokens = estimator.estimate(rendered);
  if (packet.cacheDelivery) {
    const taskDelta = renderContextDelivery({...packet,cacheDelivery:undefined});
    packet.cacheDelivery.taskDelta = {...packet.cacheDelivery.taskDelta,contentHash:createHash("sha256").update(taskDelta).digest("hex"),estimatedTokens:estimator.estimate(taskDelta),itemIds:[...packet.newItems,...packet.restoredItems].map(item=>item.candidate.item.id)};
  }
  packet.estimatedNewTokens = Math.max(0,packet.renderedEstimatedTokens-packet.estimatedRestoredTokens);
  for(const item of deliveryItems)if(item.role==="new"||item.role==="restored"){const source=[...packet.newItems,...packet.restoredItems].find(entry=>entry.candidate.item.id===item.contextItemVersionId);if(source)item.estimatedTokens=estimator.estimate(source.candidate.item.content);}
  const delivery=this.sessions.recordDelivery({sessionId:session.id,stage:options.stage,trigger:{type:options.trigger},reason:options.reason,items:deliveryItems,coverageAdded:packet.coverageAdded,coverageRemaining:packet.coverageRemaining,estimatedDuplicateTokensAvoided,expectedSnapshot:options.currentSnapshot,signalId:options.signalId,decision:packet,...(packet.cacheDelivery?{cacheDelivery:packet.cacheDelivery}:{})});
  return {...packet,id:delivery.id};
 }
}
