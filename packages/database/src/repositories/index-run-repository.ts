import type { Db } from "../connection.js";
import { now } from "@continuum/shared";

export interface RepositoryIndexRun {
  id: string;
  repository_id: number;
  snapshot_kind: string;
  base_commit_hash: string;
  worktree_hash: string | null;
  dirty: boolean;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string;
}

export class IndexRunRepository {
  constructor(private readonly db: Db) {}

  createRun(
    repositoryId: number,
    snapshotKind: string,
    baseCommitHash: string,
    worktreeHash: string | null,
    dirty: boolean
  ): RepositoryIndexRun {
    const id = crypto.randomUUID();
    const startedAt = now();
    const status = "in_progress";

    this.db
      .prepare(
        `INSERT INTO repository_index_runs (
          id, repository_id, snapshot_kind, base_commit_hash,
          worktree_hash, dirty, started_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        repositoryId,
        snapshotKind,
        baseCommitHash,
        worktreeHash,
        dirty ? 1 : 0,
        startedAt,
        status
      );

    return {
      id,
      repository_id: repositoryId,
      snapshot_kind: snapshotKind,
      base_commit_hash: baseCommitHash,
      worktree_hash: worktreeHash,
      dirty,
      started_at: startedAt,
      finished_at: null,
      duration_ms: null,
      status,
    };
  }

  finishRun(id: string, status: string, durationMs: number): void {
    this.db
      .prepare(
        "UPDATE repository_index_runs SET status = ?, finished_at = ?, duration_ms = ? WHERE id = ?"
      )
      .run(status, now(), durationMs, id);
  }
}
