export type SearchBackend = "fts5" | "fallback_lexical";

export type IndexSnapshotKind = "commit" | "worktree";

export interface IndexSnapshotIdentity {
  snapshot_kind: IndexSnapshotKind;
  base_commit_hash: string;
  worktree_hash: string | null;
  dirty: boolean;
}

export interface ContextItem {
  id: string;
  repository_id: number;
  kind: string; // e.g. "file", "symbol", "section"
  logical_key: string;
  created_at: string;
}

export type StalenessStatus = "current" | "possibly_stale" | "uncommitted" | "stale";

export interface ContextItemVersion {
  id: string;
  context_item_id: string;
  content: string;
  title: string | null;
  source_path: string;
  source_start_line: number;
  source_end_line: number;
  symbol_name: string | null;
  language: string;
  content_hash: string;
  source_blob_hash: string;
  valid_from_commit: string;
  valid_to_commit_exclusive: string | null;
  indexed_at: string;
  provenance_json: string | null;
  staleness_status: StalenessStatus;
  staleness_reason: string | null;
  metadata_json: string | null;
}

export type ContextRelationship = 
  | "contains"
  | "imports"
  | "exports"
  | "tests"
  | "configures"
  | "depends_on"
  | "derived_from"
  | "supersedes";

export interface ContextItemLink {
  id: string;
  source_item_id: string;
  target_item_id: string;
  relationship: ContextRelationship;
  created_at: string;
}

export interface ContextScoreComponents {
  lexical: number;
  symbol: number;
  path: number;
  relationship: number;
  currentVersion: number;
  stalenessPenalty: number;
}

export interface RankedContextCandidate {
  item_version: ContextItemVersion;
  score: number;
  components: ContextScoreComponents;
}

export interface ContextBudget {
  maxEstimatedTokens: number;
  maxItems: number;
  maxTokensPerItem: number;
}

export type ContextOmissionReason =
  | "budget_exceeded"
  | "stale"
  | "duplicate_content"
  | "superseded"
  | "low_score"
  | "unsafe_source";

export interface ContextOmission {
  logical_key: string;
  reason: ContextOmissionReason;
}

export interface RankedContextPacket {
  estimated_tokens: number;
  items: ContextItemVersion[];
  omissions: ContextOmission[];
}
