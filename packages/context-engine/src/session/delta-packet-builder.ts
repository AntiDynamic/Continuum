import type { ContextSessionRepository } from "@continuum/database";
import type { ContextCandidate, ContextCoverageCategory, ContextDeliveryTrigger, ContextPacketItem, ContextPacketOmission, ContextReference, ContextSession, DeltaContextPacket, IndexSnapshotIdentity } from "@continuum/shared";
import { DEFAULT_ESCALATION_LIMITS, STRATEGY_ID, STRATEGY_VERSION } from "./escalation-policy.js";

export interface DeltaPacketBuildOptions { stage: "orientation" | "implementation" | "escalation"; trigger: ContextDeliveryTrigger; reason: string; reasons: string[]; currentSnapshot: IndexSnapshotIdentity; maximumEstimatedTokens?: number; maximumItems?: number; mandatoryCoverage?: ContextCoverageCategory[]; signalId?: string; minimumCandidateScore?: number; }
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
  for(const candidate of candidates){const item=candidate.item;const duplicate=byVersion.get(item.id)??byHash.get(item.content_hash);if(duplicate){activeReferences.push({contextItemVersionId:item.id,contentHash:item.content_hash,sourcePath:item.source_path,title:item.title??undefined,estimatedTokens:candidate.estimatedTokens});estimatedDuplicateTokensAvoided+=candidate.estimatedTokens;deliveryItems.push({contextItemVersionId:item.id,role:"active_reference",estimatedTokens:candidate.estimatedTokens,contentHash:item.content_hash,presenceState:"active",duplicateOfDeliveryId:duplicate.delivery_id,requirementState:deriveRequirementState(candidate.coverageCategories,requiredCoverage),coverageCategories:candidate.coverageCategories,packetSection:derivePacketSection(candidate,mandatorySet),selectionReasons:candidate.reasons,exactMatchReason:extractExactMatchReason(candidate.reasons),relationshipReason:extractRelationshipReason(candidate.reasons),coverageReason:extractCoverageReason(candidate.reasons)});for(const category of candidate.coverageCategories)covered.add(category);continue;}if(item.valid_to_commit_exclusive!==null||item.staleness_status==="stale"){omittedItems.push({contextItemVersionId:item.id,title:item.title??item.id,reason:item.valid_to_commit_exclusive!==null?"historical":"stale",estimatedTokens:candidate.estimatedTokens});continue;}if(candidate.score<(options.minimumCandidateScore??0)&&!candidate.coverageCategories.some(category=>mandatory.has(category))){omittedItems.push({contextItemVersionId:item.id,title:item.title??item.id,reason:"low_score",estimatedTokens:candidate.estimatedTokens});continue;}const required=candidate.coverageCategories.some(category=>(mandatory.has(category)&&!covered.has(category))||["implementation","public_contract","security_constraint","database_schema","rollback"].includes(category));if(newItems.length>=maxItems||estimatedNewTokens+candidate.estimatedTokens>maxTokens){omittedItems.push({contextItemVersionId:item.id,title:item.title??item.id,reason:"budget",estimatedTokens:candidate.estimatedTokens});if(required)additional=Math.max(additional,candidate.estimatedTokens-(maxTokens-estimatedNewTokens));continue;}newItems.push({candidate,content:item.compiled_content??item.content,truncated:false});deliveryItems.push({contextItemVersionId:item.id,role:"new",estimatedTokens:candidate.estimatedTokens,contentHash:item.content_hash,presenceState:"active",requirementState:deriveRequirementState(candidate.coverageCategories,requiredCoverage),coverageCategories:candidate.coverageCategories,packetSection:derivePacketSection(candidate,mandatorySet),selectionReasons:candidate.reasons,exactMatchReason:extractExactMatchReason(candidate.reasons),relationshipReason:extractRelationshipReason(candidate.reasons),coverageReason:extractCoverageReason(candidate.reasons)});estimatedNewTokens+=candidate.estimatedTokens;for(const category of candidate.coverageCategories)covered.add(category);}
  const required=session.task.requiredCoverage.filter(entry=>entry.required).map(entry=>entry.category),coverageRemaining=required.filter(category=>!covered.has(category)&&!active.some(item=>candidates.some(c=>c.item.id===item.context_item_version_id&&c.coverageCategories.includes(category))));const packet:DeltaContextPacket={id:crypto.randomUUID(),sessionId:session.id,stage:options.stage,newItems,activeReferences,restoredItems:[],omittedItems,estimatedNewTokens,estimatedRestoredTokens:0,estimatedDuplicateTokensAvoided,coverageAdded:[...covered],coverageRemaining,trigger:options.trigger,strategyId:STRATEGY_ID,strategyVersion:STRATEGY_VERSION,decisionReasons:options.reasons,incomplete:coverageRemaining.length>0&&additional>0,...(additional>0?{additionalEstimatedTokensRequired:additional}:{})};
  const delivery=this.sessions.recordDelivery({sessionId:session.id,stage:options.stage,trigger:{type:options.trigger},reason:options.reason,items:deliveryItems,coverageAdded:packet.coverageAdded,coverageRemaining,estimatedDuplicateTokensAvoided,expectedSnapshot:options.currentSnapshot,signalId:options.signalId,decision:packet});return {...packet,id:delivery.id};
 }
}
