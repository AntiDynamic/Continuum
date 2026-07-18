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
  sql?: string;
  up?: (db: any) => void;
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
  {
    version: 2,
    description: "Continuum V2 Repository Indexing and Context",
    sql: `
      -- Track indexing runs
      CREATE TABLE IF NOT EXISTS repository_index_runs (
        id               TEXT    PRIMARY KEY,
        repository_id    INTEGER NOT NULL REFERENCES repositories(id),
        snapshot_kind    TEXT    NOT NULL,
        base_commit_hash TEXT    NOT NULL,
        worktree_hash    TEXT,
        dirty            INTEGER NOT NULL DEFAULT 0,
        started_at       TEXT    NOT NULL,
        finished_at      TEXT,
        duration_ms      INTEGER,
        status           TEXT    NOT NULL
      );

      -- Files processed during an indexing run
      CREATE TABLE IF NOT EXISTS indexed_files (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        index_run_id     TEXT    NOT NULL REFERENCES repository_index_runs(id),
        path             TEXT    NOT NULL,
        skip_reason      TEXT,
        size_bytes       INTEGER,
        detected_type    TEXT
      );

      -- Stable logical identity for context items
      CREATE TABLE IF NOT EXISTS context_items (
        id            TEXT    PRIMARY KEY,
        repository_id INTEGER NOT NULL REFERENCES repositories(id),
        kind          TEXT    NOT NULL,
        logical_key   TEXT    NOT NULL,
        created_at    TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_context_items_repo_logical ON context_items(repository_id, logical_key);

      -- Immutable content versions for context items
      CREATE TABLE IF NOT EXISTS context_item_versions (
        id                        TEXT    PRIMARY KEY,
        context_item_id           TEXT    NOT NULL REFERENCES context_items(id),
        content                   TEXT    NOT NULL,
        title                     TEXT,
        source_path               TEXT    NOT NULL,
        source_start_line         INTEGER NOT NULL,
        source_end_line           INTEGER NOT NULL,
        symbol_name               TEXT,
        language                  TEXT    NOT NULL,
        content_hash              TEXT    NOT NULL,
        source_blob_hash          TEXT    NOT NULL,
        valid_from_commit         TEXT    NOT NULL,
        valid_to_commit_exclusive TEXT,
        indexed_at                TEXT    NOT NULL,
        provenance_json           TEXT,
        staleness_status          TEXT    NOT NULL,
        staleness_reason          TEXT,
        metadata_json             TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_context_item_versions_item_id ON context_item_versions(context_item_id);

      -- Relationships between context items
      CREATE TABLE IF NOT EXISTS context_item_links (
        id             TEXT    PRIMARY KEY,
        source_item_id TEXT    NOT NULL REFERENCES context_items(id),
        target_item_id TEXT    NOT NULL REFERENCES context_items(id),
        relationship   TEXT    NOT NULL,
        created_at     TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_context_item_links_source ON context_item_links(source_item_id);
      CREATE INDEX IF NOT EXISTS idx_context_item_links_target ON context_item_links(target_item_id);

      -- Track context retrieval requests
      CREATE TABLE IF NOT EXISTS context_retrievals (
        id           TEXT    PRIMARY KEY,
        run_id       TEXT    REFERENCES agent_runs(id),
        query        TEXT    NOT NULL,
        strategy     TEXT    NOT NULL,
        timestamp    TEXT    NOT NULL,
        budget_json  TEXT,
        packet_json  TEXT
      );

      -- Record exact items returned for observability
      CREATE TABLE IF NOT EXISTS context_retrieval_items (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        retrieval_id          TEXT    NOT NULL REFERENCES context_retrievals(id),
        item_version_id       TEXT    NOT NULL REFERENCES context_item_versions(id),
        score                 REAL    NOT NULL,
        score_components_json TEXT    NOT NULL,
        rank                  INTEGER NOT NULL
      );
    `,
    up: (db: any) => {
      let hasFts5 = false;
      try {
        db.exec("CREATE VIRTUAL TABLE temp.continuum_fts_probe USING fts5(content);");
        db.exec("DROP TABLE temp.continuum_fts_probe;");
        hasFts5 = true;
      } catch (err) {
        // FTS5 unavailable
      }

      if (hasFts5) {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS context_items_fts USING fts5(
            content,
            title,
            symbol_name
          );
        `);
      }
    }
  },
  {
    version: 3,
    description: "Context efficiency, pricing, telemetry, and delivery ledger",
    sql: `
      CREATE TABLE pricing_profiles (
        id                                TEXT PRIMARY KEY,
        provider                          TEXT NOT NULL,
        model                             TEXT NOT NULL,
        version                           TEXT,
        input_credits_per_million_tokens  REAL,
        cached_input_credits_per_million_tokens REAL,
        output_credits_per_million_tokens REAL,
        source                            TEXT NOT NULL,
        effective_from                    TEXT NOT NULL,
        created_at                        TEXT NOT NULL,
        CHECK (source IN ('provider_reported', 'user_configured', 'unknown'))
      );
      CREATE INDEX idx_pricing_profiles_model_effective
        ON pricing_profiles(provider, model, effective_from DESC, created_at DESC);

      CREATE TABLE agent_usage_evidence (
        run_id               TEXT PRIMARY KEY REFERENCES agent_runs(id),
        provider             TEXT,
        model                TEXT,
        input_tokens         INTEGER,
        cached_input_tokens  INTEGER,
        output_tokens        INTEGER,
        reasoning_tokens     INTEGER,
        tool_calls           INTEGER,
        measurement          TEXT NOT NULL,
        recorded_at          TEXT NOT NULL,
        CHECK (measurement IN ('provider_reported', 'agent_reported', 'estimated', 'unavailable'))
      );

      CREATE TABLE run_cost_evidence (
        run_id               TEXT PRIMARY KEY REFERENCES agent_runs(id),
        pricing_profile_id   TEXT REFERENCES pricing_profiles(id),
        input_credits        REAL,
        cached_input_credits REAL,
        output_credits       REAL,
        total_credits        REAL,
        measurement          TEXT NOT NULL,
        calculated_at        TEXT NOT NULL,
        CHECK (measurement IN ('measured', 'derived', 'estimated', 'unavailable'))
      );

      CREATE TABLE context_packets (
        id                    TEXT PRIMARY KEY,
        run_id                TEXT NOT NULL REFERENCES agent_runs(id),
        estimator_id          TEXT NOT NULL,
        accounting_json       TEXT NOT NULL,
        created_at            TEXT NOT NULL
      );
      CREATE INDEX idx_context_packets_run ON context_packets(run_id, created_at);

      CREATE TABLE context_deliveries (
        id                       TEXT PRIMARY KEY,
        run_id                   TEXT NOT NULL REFERENCES agent_runs(id),
        packet_id                TEXT NOT NULL REFERENCES context_packets(id),
        context_item_version_id  TEXT NOT NULL REFERENCES context_item_versions(id),
        delivery_stage           TEXT NOT NULL,
        estimated_tokens         INTEGER NOT NULL,
        delivered_at             TEXT NOT NULL,
        was_duplicate            INTEGER NOT NULL DEFAULT 0,
        duplicate_of_delivery_id TEXT REFERENCES context_deliveries(id),
        supplied_to_agent        INTEGER NOT NULL DEFAULT 1,
        presence_state           TEXT NOT NULL DEFAULT 'active',
        content_hash             TEXT NOT NULL,
        superseded_by_checkpoint_id TEXT,
        CHECK (delivery_stage IN ('orientation', 'implementation', 'escalation', 'restoration')),
        CHECK (presence_state IN ('active', 'checkpointed', 'expired', 'unknown'))
      );
      CREATE INDEX idx_context_deliveries_run
        ON context_deliveries(run_id, delivered_at);
      CREATE INDEX idx_context_deliveries_active_hash
        ON context_deliveries(run_id, content_hash, presence_state, supplied_to_agent);
    `,
  },
  {
    version: 4,
    description: "Context Compiler, explicit FTS identity, relationships, and retrieval evidence",
    sql: `
      ALTER TABLE context_item_versions ADD COLUMN contextual_header TEXT;
      ALTER TABLE context_item_versions ADD COLUMN compiled_content TEXT;
      ALTER TABLE context_item_links ADD COLUMN confidence TEXT NOT NULL DEFAULT 'medium';
      ALTER TABLE context_item_links ADD COLUMN evidence_json TEXT;
      CREATE TABLE context_retrieval_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        retrieval_id TEXT NOT NULL REFERENCES context_retrievals(id),
        item_version_id TEXT NOT NULL REFERENCES context_item_versions(id),
        search_backend TEXT NOT NULL,
        raw_lexical_score REAL NOT NULL,
        normalized_lexical_score REAL NOT NULL,
        score_components_json TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        coverage_json TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        final_rank INTEGER NOT NULL,
        included INTEGER NOT NULL,
        omission_reason TEXT,
        packet_section TEXT,
        strategy_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_context_retrieval_evidence_retrieval
        ON context_retrieval_evidence(retrieval_id, final_rank);
    `,
    up: (db: any) => {
      const hasFts5 = (() => {
        try {
          db.exec("CREATE VIRTUAL TABLE temp.continuum_compiler_fts_probe USING fts5(content);");
          db.exec("DROP TABLE temp.continuum_compiler_fts_probe;");
          return true;
        } catch {
          return false;
        }
      })();
      if (hasFts5) {
        db.exec(`
          CREATE VIRTUAL TABLE context_items_fts_v2 USING fts5(
            version_id UNINDEXED,
            repository_id UNINDEXED,
            title,
            symbol_name,
            source_path,
            contextual_header,
            content
          );
          INSERT INTO context_items_fts_v2(
            version_id, repository_id, title, symbol_name, source_path,
            contextual_header, content
          )
          SELECT v.id, i.repository_id, COALESCE(v.title, ''),
                 COALESCE(v.symbol_name, ''), v.source_path,
                 COALESCE(v.contextual_header, ''),
                 COALESCE(v.compiled_content, v.content)
          FROM context_item_versions v
          JOIN context_items i ON i.id = v.context_item_id;
        `);
      }
    },
  }
];
