/**
 * Typed repository layer for agent_runs and related tables.
 * Uses node:sqlite (Node.js built-in) via the Db type from connection.ts.
 */

import type { Db } from "./connection.js";
import type {
  RunStatus,
  OutputMode,
  AttributionConfidence,
} from "@continuum/shared";
import { now } from "@continuum/shared";

export interface AgentRunRow {
  id: string;
  repository_id: number;
  agent_id: string;
  agent_version: string | null;
  task: string;
  status: RunStatus;
  output_mode: OutputMode;
  branch: string | null;
  starting_commit: string | null;
  ending_commit: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  exit_code: number | null;
  exact_command: string | null;
  cancelled: number;
  cancellation_reason: string | null;
  error_summary: string | null;
  attribution_confidence: AttributionConfidence;
}

export interface CreateRunParams {
  id: string;
  repositoryId: number;
  agentId: string;
  agentVersion?: string;
  task: string;
  branch?: string;
  startingCommit?: string;
  exactCommand?: string;
}

export interface FinishRunParams {
  id: string;
  status: RunStatus;
  endingCommit?: string;
  exitCode?: number;
  errorSummary?: string;
  cancelled?: boolean;
  cancellationReason?: string;
  outputMode?: OutputMode;
  attributionConfidence?: AttributionConfidence;
}

export class RunRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  create(params: CreateRunParams): void {
    this.db
      .prepare(
        `INSERT INTO agent_runs
           (id, repository_id, agent_id, agent_version, task, status,
            branch, starting_commit, exact_command, started_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.repositoryId,
        params.agentId,
        params.agentVersion ?? null,
        params.task,
        params.branch ?? null,
        params.startingCommit ?? null,
        params.exactCommand ?? null,
        now(),
      );
  }

  finish(params: FinishRunParams): void {
    const finishedAt = now();
    const startRow = this.db
      .prepare("SELECT started_at FROM agent_runs WHERE id = ?")
      .get(params.id) as { started_at: string } | undefined;

    const durationMs = startRow
      ? Date.now() - new Date(startRow.started_at).getTime()
      : null;

    this.db
      .prepare(
        `UPDATE agent_runs SET
           status                = ?,
           ending_commit         = ?,
           finished_at           = ?,
           duration_ms           = ?,
           exit_code             = ?,
           error_summary         = ?,
           cancelled             = ?,
           cancellation_reason   = ?,
           output_mode           = COALESCE(?, output_mode),
           attribution_confidence= COALESCE(?, attribution_confidence)
         WHERE id = ?`,
      )
      .run(
        params.status,
        params.endingCommit ?? null,
        finishedAt,
        durationMs,
        params.exitCode ?? null,
        params.errorSummary ?? null,
        params.cancelled === true ? 1 : 0,
        params.cancellationReason ?? null,
        params.outputMode ?? null,
        params.attributionConfidence ?? null,
        params.id,
      );
  }

  updateCommand(id: string, command: string, outputMode: string): void {
    this.db
      .prepare(
        "UPDATE agent_runs SET exact_command = ?, output_mode = ? WHERE id = ?",
      )
      .run(command, outputMode, id);
  }

  findById(id: string): AgentRunRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM agent_runs WHERE id = ?")
        .get(id) as unknown as AgentRunRow | undefined) ?? null
    );
  }

  findLatest(): AgentRunRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 1")
        .get() as unknown as AgentRunRow | undefined) ?? null
    );
  }

  list(limit = 20): AgentRunRow[] {
    return this.db
      .prepare("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?")
      .all(limit) as unknown as AgentRunRow[];
  }
}

export interface RepositoryRow {
  id: number;
  canonical_path: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export class RepositoryRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  upsert(canonicalPath: string, name: string): RepositoryRow {
    const existing = this.db
      .prepare("SELECT * FROM repositories WHERE canonical_path = ?")
      .get(canonicalPath) as unknown as RepositoryRow | undefined;

    if (existing) {
      this.db
        .prepare("UPDATE repositories SET updated_at = ? WHERE id = ?")
        .run(now(), existing.id);
      return existing;
    }

    const result = this.db
      .prepare(
        `INSERT INTO repositories (canonical_path, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(canonicalPath, name, now(), now());

    const rowid =
      typeof result.lastInsertRowid === "bigint"
        ? Number(result.lastInsertRowid)
        : result.lastInsertRowid;

    return this.db
      .prepare("SELECT * FROM repositories WHERE id = ?")
      .get(rowid) as unknown as RepositoryRow;
  }

  findByPath(canonicalPath: string): RepositoryRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM repositories WHERE canonical_path = ?")
        .get(canonicalPath) as unknown as RepositoryRow | undefined) ?? null
    );
  }
}
