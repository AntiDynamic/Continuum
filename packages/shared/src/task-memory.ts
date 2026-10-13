import type { IndexSnapshotIdentity } from "./context-domain.js";

export type TaskMemoryKind = "objective" | "requirement" | "constraint" | "decision" | "completed" | "pending" | "question" | "failure" | "validation" | "next_action" | "source";
export type MemoryAuthority = "user" | "observed" | "agent_reported";
export interface MemoryWrite {
  kind: TaskMemoryKind;
  text: string;
  authority: MemoryAuthority;
  critical?: boolean;
  supersedes?: string;
  operationKey?: string;
  snapshot?: IndexSnapshotIdentity;
  sourceVersionId?: string;
  metadata?: Record<string, unknown>;
}
export interface TaskEvidence {
  id: string; sessionId: string; text: string; authority: MemoryAuthority;
  snapshot: IndexSnapshotIdentity | null; sourceVersionId: string | null;
  metadata: Record<string, unknown>; createdAt: string;
}
export interface TaskMemoryEntry {
  id: string; sessionId: string; version: number; kind: TaskMemoryKind; text: string;
  authority: MemoryAuthority; critical: boolean; evidenceId: string;
  supersedes: string | null; supersededBy: string | null;
}
export interface TaskMemoryState {
  sessionId: string; version: number; entries: TaskMemoryEntry[]; evidence: TaskEvidence[];
}
export interface DurableRecoveryPacket {
  schemaVersion: "continuum.durable-recovery.v1";
  sessionId: string; repositoryId: number; memoryVersion: number;
  snapshot: IndexSnapshotIdentity; renderedContent: string; renderedHash: string;
  estimatedTokens: number; maximumEstimatedTokens: number; tokenMeasurement: "estimated";
  incomplete: boolean; omittedCriticalIds: string[]; omittedOptionalIds: string[];
  staleEvidenceIds: string[]; evidenceIds: string[];
  latestValidation: { evidenceId: string; command: string; exitCode: number; freshness: "current" | "historical" } | null;
}
