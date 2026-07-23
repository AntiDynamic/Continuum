import type { ContextCoverageCategory, ContextPacketItem, ContextPacketOmission, TaskAnalysis } from "./context-compiler-domain.js";
import type { IndexSnapshotIdentity } from "./context-domain.js";

export type ContextSessionStatus = "planning" | "active" | "checkpointed" | "completed" | "failed" | "cancelled";
export type ContextSessionDeliveryStage = "orientation" | "implementation" | "escalation" | "restoration" | "checkpoint";
export type SessionContextPresenceState = "active" | "checkpointed" | "expired" | "restoration_required" | "unknown";
export type ContextDeliveryTrigger = "initial" | "agent_request" | "test_failure" | "missing_coverage" | "out_of_scope_modification";
export interface ContextSession { id: string; repositoryId: number; runId?: string; task: TaskAnalysis; snapshot: IndexSnapshotIdentity; strategyId: string; strategyVersion: string; status: ContextSessionStatus; maximumEstimatedTokens: number; deliveredEstimatedTokens: number; activeEstimatedTokens: number; remainingEstimatedTokens: number; createdAt: string; updatedAt: string; completedAt?: string; }
export interface ContextReference { contextItemVersionId: string; contentHash: string; sourcePath: string; title?: string; estimatedTokens: number; }
export interface DeltaContextPacket { id: string; sessionId: string; stage: ContextSessionDeliveryStage; newItems: ContextPacketItem[]; activeReferences: ContextReference[]; restoredItems: ContextPacketItem[]; omittedItems: ContextPacketOmission[]; estimatedNewTokens: number; estimatedRestoredTokens: number; estimatedDuplicateTokensAvoided: number; coverageAdded: ContextCoverageCategory[]; coverageRemaining: ContextCoverageCategory[]; trigger: ContextDeliveryTrigger; strategyId: string; strategyVersion: string; decisionReasons: string[]; incomplete: boolean; additionalEstimatedTokensRequired?: number; }
export type ContextRequestReason = "missing_implementation" | "missing_test" | "missing_contract" | "missing_constraint" | "test_failure" | "scope_check" | "other";
export interface AgentContextRequest { query: string; reason?: ContextRequestReason; requestedSymbols?: string[]; requestedPaths?: string[]; requestedCoverage?: ContextCoverageCategory[]; maximumEstimatedTokens?: number; }
export type ContextControlSignal = ({ type: "agent_context_request" } & AgentContextRequest) | { type: "test_failure"; failingTests: string[]; errorSummary: string; relatedPaths?: string[]; relatedSymbols?: string[]; maximumEstimatedTokens?: number } | { type: "missing_coverage"; categories: ContextCoverageCategory[]; maximumEstimatedTokens?: number } | { type: "out_of_scope_modification"; modifiedPaths: string[]; predictedPaths: string[]; maximumEstimatedTokens?: number };
export interface ContextEscalationLimits { maximumEscalations: number; maximumEstimatedTokens: number; maximumEstimatedTokensPerEscalation: number; maximumItemsPerEscalation: number; minimumCandidateScore: number; }
export interface CreateContextSessionInput { repositoryId: number; repositoryRoot: string; task: string; runId?: string; maximumEstimatedTokens?: number; }
export interface ContextSessionResult { status: "completed" | "failed" | "cancelled"; reason?: string; }
export interface ContextControlDecision { sessionId: string; signalType: ContextControlSignal["type"]; reasons: string[]; incomplete: boolean; remediation?: string; }
export interface AdaptiveContextController { createSession(input: CreateContextSessionInput): Promise<ContextSession>; createInitialDelivery(sessionId: string): Promise<DeltaContextPacket>; requestContext(sessionId: string, request: AgentContextRequest): Promise<DeltaContextPacket>; reportSignal(sessionId: string, signal: ContextControlSignal): Promise<DeltaContextPacket | ContextControlDecision>; completeSession(sessionId: string, result: ContextSessionResult): Promise<ContextSession>; }

export const CONTEXT_SESSION_SCHEMA_VERSION = "continuum.context-session.v1" as const;
export const CONTEXT_SESSION_REPORT_SCHEMA_VERSION = "continuum.context-session-report.v1" as const;
export interface ContextSessionDeliveryReport { id: string; sequenceNumber: number; stage: string; trigger: unknown; reason: string; estimatedNewTokens: number; estimatedRestoredTokens: number; estimatedDuplicateTokensAvoided: number; coverageAdded: ContextCoverageCategory[]; coverageRemaining: ContextCoverageCategory[]; newItemCount: number; activeReferenceCount: number; restoredItemCount: number; omittedItemCount: number; createdAt: string; }
export interface ContextSessionReport {
  schemaVersion: typeof CONTEXT_SESSION_REPORT_SCHEMA_VERSION;
  session: { id: string; status: ContextSessionStatus; task: string; taskClass: TaskAnalysis["taskClass"]; riskLevel: TaskAnalysis["riskLevel"]; strategyId: string; strategyVersion: string };
  snapshot: IndexSnapshotIdentity;
  budget: { maximumEstimatedTokens: number; deliveredEstimatedTokens: number; activeEstimatedTokens: number; remainingEstimatedTokens: number };
  activity: { deliveryCount: number; escalationCount: number; signalCount: number; newItemCount: number; activeReferenceCount: number; restoredItemCount: number; omittedItemCount: number };
  context: { estimatedInitialTokens: number; estimatedEscalationTokens: number; estimatedDuplicateTokensAvoided: number };
  coverage: { added: ContextCoverageCategory[]; remaining: ContextCoverageCategory[]; complete: boolean };
  evidence: { tokenMeasurement: "estimated"; duplicateAvoidanceMeasurement: "estimated"; providerUsageAvailable: boolean };
  deliveries: ContextSessionDeliveryReport[];
  createdAt: string;
  completedAt?: string;
}
export interface ContextSessionAggregate {
  schemaVersion: typeof CONTEXT_SESSION_SCHEMA_VERSION;
  session: ContextSession;
  repository: { id: number; path: string; name: string };
  deliveryCount: number; escalationCount: number; signalCount: number; activeContextItemCount: number;
  coverage: { added: ContextCoverageCategory[]; remaining: ContextCoverageCategory[]; complete: boolean };
}
export interface StartContextSessionInput { task: string; maximumEstimatedTokens?: number; runId?: string; createInitialContext?: boolean }
export interface StartContextSessionResult { schemaVersion: typeof CONTEXT_SESSION_SCHEMA_VERSION; session: ContextSession; requiredCoverage: ContextCoverageCategory[]; initialContext?: DeltaContextPacket }
export interface ContextSessionListResult { schemaVersion: typeof CONTEXT_SESSION_SCHEMA_VERSION; repositoryId: number; sessions: ContextSessionAggregate[] }
export function snapshotsEqual(left: IndexSnapshotIdentity, right: IndexSnapshotIdentity): boolean { if (left.snapshot_kind !== right.snapshot_kind || left.base_commit_hash !== right.base_commit_hash) return false; return left.snapshot_kind === "commit" ? left.worktree_hash === null && right.worktree_hash === null : Boolean(left.worktree_hash) && left.worktree_hash === right.worktree_hash; }
