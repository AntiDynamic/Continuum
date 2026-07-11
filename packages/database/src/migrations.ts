/**
 * SQL migration definitions for Continuum.
 *
 * Each migration is identified by a sequential integer version.
 * Migrations are applied in order and each is executed inside a transaction.
 * Once applied, a migration is never re-applied or modified — only new
 * migrations can be added.
 *
 * Design rules:
 * - Never modify an existing migration — add a new one.
 * - Every column has an explicit type and NOT NULL or default.
 * - Foreign keys use integer IDs throughout.
 * - TEXT columns store ISO-8601 timestamps (not SQLite DATETIME).
 * - JSON blobs are stored as TEXT.
 */

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial schema",
    sql: `
      -- Track the migration state itself
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        description TEXT    NOT NULL,
        applied_at  TEXT    NOT NULL
      );

      -- Repositories observed by Continuum
      CREATE TABLE IF NOT EXISTS repositories (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_path TEXT    NOT NULL UNIQUE,
        name           TEXT    NOT NULL,
        created_at     TEXT    NOT NULL,
        updated_at     TEXT    NOT NULL
      );

      -- One row per agent run
      CREATE TABLE IF NOT EXISTS agent_runs (
        id                    TEXT    PRIMARY KEY,
        repository_id         INTEGER NOT NULL REFERENCES repositories(id),
        agent_id              TEXT    NOT NULL,
        agent_version         TEXT,
        task                  TEXT    NOT NULL,
        status                TEXT    NOT NULL DEFAULT 'running',
        output_mode           TEXT    NOT NULL DEFAULT 'unknown',
        branch                TEXT,
        starting_commit       TEXT,
        ending_commit         TEXT,
        started_at            TEXT    NOT NULL,
        finished_at           TEXT,
        duration_ms           INTEGER,
        exit_code             INTEGER,
        exact_command         TEXT,
        cancelled             INTEGER NOT NULL DEFAULT 0,
        cancellation_reason   TEXT,
        error_summary         TEXT,
        attribution_confidence TEXT   NOT NULL DEFAULT 'unknown'
      );

      -- Individual events streamed from the agent
      CREATE TABLE IF NOT EXISTS agent_events (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id            TEXT    NOT NULL REFERENCES agent_runs(id),
        sequence_number   INTEGER NOT NULL,
        event_type        TEXT    NOT NULL,
        timestamp         TEXT    NOT NULL,
        source            TEXT    NOT NULL,
        parsed_json       TEXT,
        raw_payload       TEXT,
        parse_status      TEXT    NOT NULL DEFAULT 'raw',
        redaction_applied INTEGER NOT NULL DEFAULT 0
      );

      -- Git snapshots captured before and after each run
      CREATE TABLE IF NOT EXISTS git_snapshots (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id           TEXT    NOT NULL REFERENCES agent_runs(id),
        phase            TEXT    NOT NULL,
        commit_hash      TEXT,
        branch           TEXT,
        status_porcelain TEXT,
        captured_at      TEXT    NOT NULL
      );

      -- Pre-run baseline hashes for dirty files to distinguish
      -- agent changes from pre-existing modifications
      CREATE TABLE IF NOT EXISTS file_baselines (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id      TEXT    NOT NULL REFERENCES agent_runs(id),
        path        TEXT    NOT NULL,
        phase       TEXT    NOT NULL,
        content_hash TEXT,
        git_status  TEXT,
        patch_path  TEXT
      );

      -- File-level changes detected between before/after snapshots
      CREATE TABLE IF NOT EXISTS file_changes (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id                TEXT    NOT NULL REFERENCES agent_runs(id),
        path_before           TEXT,
        path_after            TEXT,
        change_type           TEXT    NOT NULL,
        additions             INTEGER,
        deletions             INTEGER,
        binary                INTEGER NOT NULL DEFAULT 0,
        attribution_confidence TEXT   NOT NULL DEFAULT 'unknown'
      );

      -- Test command executions (baseline and final)
      CREATE TABLE IF NOT EXISTS test_runs (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id            TEXT    NOT NULL REFERENCES agent_runs(id),
        phase             TEXT    NOT NULL,
        command           TEXT    NOT NULL,
        working_directory TEXT    NOT NULL,
        started_at        TEXT    NOT NULL,
        finished_at       TEXT,
        duration_ms       INTEGER,
        exit_code         INTEGER,
        passed_count      INTEGER,
        failed_count      INTEGER,
        parse_confidence  TEXT    NOT NULL DEFAULT 'unknown',
        stdout_path       TEXT,
        stderr_path       TEXT,
        timed_out         INTEGER NOT NULL DEFAULT 0,
        cancelled         INTEGER NOT NULL DEFAULT 0
      );

      -- Numeric metrics (tokens, tool calls, etc.) keyed by name
      CREATE TABLE IF NOT EXISTS usage_metrics (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id        TEXT    NOT NULL REFERENCES agent_runs(id),
        metric_name   TEXT    NOT NULL,
        numeric_value REAL    NOT NULL,
        unit          TEXT    NOT NULL DEFAULT 'count',
        source        TEXT    NOT NULL DEFAULT 'adapter',
        quality       TEXT    NOT NULL DEFAULT 'exact',
        exact         INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT
      );

      -- User-provided outcome labels and notes
      CREATE TABLE IF NOT EXISTS user_outcomes (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id                    TEXT    NOT NULL UNIQUE REFERENCES agent_runs(id),
        status                    TEXT    NOT NULL,
        required_corrections      INTEGER NOT NULL DEFAULT 0,
        regression_observed       INTEGER NOT NULL DEFAULT 0,
        unrelated_changes_observed INTEGER NOT NULL DEFAULT 0,
        solution_reverted         INTEGER NOT NULL DEFAULT 0,
        notes                     TEXT,
        created_at                TEXT    NOT NULL
      );

      -- Indexes for common query patterns
      CREATE INDEX IF NOT EXISTS idx_agent_events_run_id    ON agent_events(run_id, sequence_number);
      CREATE INDEX IF NOT EXISTS idx_git_snapshots_run_id   ON git_snapshots(run_id, phase);
      CREATE INDEX IF NOT EXISTS idx_file_changes_run_id    ON file_changes(run_id);
      CREATE INDEX IF NOT EXISTS idx_test_runs_run_id       ON test_runs(run_id, phase);
      CREATE INDEX IF NOT EXISTS idx_usage_metrics_run_id   ON usage_metrics(run_id);
      CREATE INDEX IF NOT EXISTS idx_file_baselines_run_id  ON file_baselines(run_id);
    `,
  },
];
