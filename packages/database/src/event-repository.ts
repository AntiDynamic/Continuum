/**
 * Repository for agent events and git snapshots.
 */

import type { Db } from "./connection.js";
import type { AgentEvent, ParseStatus, RunPhase } from "@continuum/shared";

export interface AgentEventRow {
  id: number;
  run_id: string;
  sequence_number: number;
  event_type: string;
  timestamp: string;
  source: string;
  parsed_json: string | null;
  raw_payload: string | null;
  parse_status: ParseStatus;
  redaction_applied: number;
}

export class EventRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  insert(event: AgentEvent, redactionApplied: boolean): void {
    const payload =
      "payload" in event && typeof event.payload === "object" && event.payload !== null
        ? event.payload
        : {};
    this.db
      .prepare(
        `INSERT INTO agent_events
           (run_id, sequence_number, event_type, timestamp, source,
            parsed_json, raw_payload, parse_status, redaction_applied)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.runId,
        event.sequenceNumber,
        event.eventType,
        event.timestamp,
        event.source,
        JSON.stringify(event),
        "rawPayload" in payload
          ? (payload as { rawPayload?: string }).rawPayload ?? null
          : null,
        "parseStatus" in payload
          ? (payload as { parseStatus: string }).parseStatus
          : "parsed",
        redactionApplied ? 1 : 0,
      );
  }

  insertBatch(events: AgentEvent[], redactionApplied: boolean): void {
    this.db.exec("BEGIN");
    try {
      for (const event of events) {
        this.insert(event, redactionApplied);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  findByRunId(runId: string): AgentEventRow[] {
    return this.db
      .prepare(
        "SELECT * FROM agent_events WHERE run_id = ? ORDER BY sequence_number ASC",
      )
      .all(runId) as unknown as AgentEventRow[];
  }

  countByRunId(runId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM agent_events WHERE run_id = ?",
      )
      .get(runId) as { count: number };
    return row.count;
  }

  countByType(runId: string, eventType: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM agent_events WHERE run_id = ? AND event_type = ?",
      )
      .get(runId, eventType) as { count: number };
    return row.count;
  }
}

export interface GitSnapshotRow {
  id: number;
  run_id: string;
  phase: RunPhase;
  commit_hash: string | null;
  branch: string | null;
  status_porcelain: string | null;
  captured_at: string;
}

export class GitSnapshotRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  insert(
    runId: string,
    phase: RunPhase,
    commitHash: string | null,
    branch: string | null,
    statusPorcelain: string | null,
    capturedAt: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO git_snapshots
           (run_id, phase, commit_hash, branch, status_porcelain, captured_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(runId, phase, commitHash, branch, statusPorcelain, capturedAt);
  }

  findByRunId(runId: string): GitSnapshotRow[] {
    return this.db
      .prepare("SELECT * FROM git_snapshots WHERE run_id = ? ORDER BY id ASC")
      .all(runId) as unknown as GitSnapshotRow[];
  }

  findByPhase(runId: string, phase: RunPhase): GitSnapshotRow | null {
    return (
      (this.db
        .prepare(
          "SELECT * FROM git_snapshots WHERE run_id = ? AND phase = ? LIMIT 1",
        )
        .get(runId, phase) as unknown as GitSnapshotRow | undefined) ?? null
    );
  }
}

export interface FileChangeRow {
  id: number;
  run_id: string;
  path_before: string | null;
  path_after: string | null;
  change_type: string;
  additions: number | null;
  deletions: number | null;
  binary: number;
  attribution_confidence: string;
}

export class FileChangeRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  insertBatch(
    runId: string,
    changes: Array<{
      pathBefore?: string;
      pathAfter?: string;
      changeType: string;
      additions?: number;
      deletions?: number;
      binary?: boolean;
      attributionConfidence?: string;
    }>,
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO file_changes
         (run_id, path_before, path_after, change_type, additions, deletions, binary, attribution_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.exec("BEGIN");
    try {
      for (const c of changes) {
        insert.run(
          runId,
          c.pathBefore ?? null,
          c.pathAfter ?? null,
          c.changeType,
          c.additions ?? null,
          c.deletions ?? null,
          c.binary === true ? 1 : 0,
          c.attributionConfidence ?? "unknown",
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  findByRunId(runId: string): FileChangeRow[] {
    return this.db
      .prepare("SELECT * FROM file_changes WHERE run_id = ?")
      .all(runId) as unknown as FileChangeRow[];
  }
}

export interface TestRunRow {
  id: number;
  run_id: string;
  phase: string;
  command: string;
  working_directory: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  exit_code: number | null;
  passed_count: number | null;
  failed_count: number | null;
  parse_confidence: string;
  stdout_path: string | null;
  stderr_path: string | null;
  timed_out: number;
  cancelled: number;
}

export class TestRunRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  insert(params: {
    runId: string;
    phase: string;
    command: string;
    workingDirectory: string;
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    exitCode?: number;
    passedCount?: number;
    failedCount?: number;
    parseConfidence?: string;
    stdoutPath?: string;
    stderrPath?: string;
    timedOut?: boolean;
    cancelled?: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO test_runs
           (run_id, phase, command, working_directory, started_at, finished_at,
            duration_ms, exit_code, passed_count, failed_count, parse_confidence,
            stdout_path, stderr_path, timed_out, cancelled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.runId,
        params.phase,
        params.command,
        params.workingDirectory,
        params.startedAt,
        params.finishedAt ?? null,
        params.durationMs ?? null,
        params.exitCode ?? null,
        params.passedCount ?? null,
        params.failedCount ?? null,
        params.parseConfidence ?? "unknown",
        params.stdoutPath ?? null,
        params.stderrPath ?? null,
        params.timedOut === true ? 1 : 0,
        params.cancelled === true ? 1 : 0,
      );
  }

  findByRunId(runId: string): TestRunRow[] {
    return this.db
      .prepare("SELECT * FROM test_runs WHERE run_id = ? ORDER BY id ASC")
      .all(runId) as unknown as TestRunRow[];
  }
}

export interface UsageMetricRow {
  id: number;
  run_id: string;
  metric_name: string;
  numeric_value: number;
  unit: string;
  source: string;
  quality: string;
  exact: number;
  metadata_json: string | null;
}

export class UsageMetricRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  insert(params: {
    runId: string;
    metricName: string;
    numericValue: number;
    unit?: string;
    source?: string;
    quality?: string;
    exact?: boolean;
    metadataJson?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO usage_metrics
           (run_id, metric_name, numeric_value, unit, source, quality, exact, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.runId,
        params.metricName,
        params.numericValue,
        params.unit ?? "count",
        params.source ?? "adapter",
        params.quality ?? "exact",
        params.exact !== false ? 1 : 0,
        params.metadataJson ?? null,
      );
  }

  findByRunId(runId: string): UsageMetricRow[] {
    return this.db
      .prepare("SELECT * FROM usage_metrics WHERE run_id = ?")
      .all(runId) as unknown as UsageMetricRow[];
  }
}

export interface UserOutcomeRow {
  id: number;
  run_id: string;
  status: string;
  required_corrections: number;
  regression_observed: number;
  unrelated_changes_observed: number;
  solution_reverted: number;
  notes: string | null;
  created_at: string;
}

export class UserOutcomeRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  upsert(params: {
    runId: string;
    status: string;
    requiredCorrections?: boolean;
    regressionObserved?: boolean;
    unrelatedChangesObserved?: boolean;
    solutionReverted?: boolean;
    notes?: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO user_outcomes
           (run_id, status, required_corrections, regression_observed,
            unrelated_changes_observed, solution_reverted, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.runId,
        params.status,
        params.requiredCorrections === true ? 1 : 0,
        params.regressionObserved === true ? 1 : 0,
        params.unrelatedChangesObserved === true ? 1 : 0,
        params.solutionReverted === true ? 1 : 0,
        params.notes ?? null,
        params.createdAt,
      );
  }

  findByRunId(runId: string): UserOutcomeRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM user_outcomes WHERE run_id = ?")
        .get(runId) as unknown as UserOutcomeRow | undefined) ?? null
    );
  }
}
