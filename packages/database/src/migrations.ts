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
  requiresForeignKeysOff?: boolean;
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
  },
  {
    version: 5,
    description: "Context sessions and progressive delivery",
    sql: `
      CREATE TABLE context_sessions (
        id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL REFERENCES repositories(id), run_id TEXT REFERENCES agent_runs(id),
        task_text TEXT NOT NULL, task_analysis_json TEXT NOT NULL, snapshot_kind TEXT NOT NULL,
        base_commit_hash TEXT NOT NULL, worktree_hash TEXT, strategy_id TEXT NOT NULL, strategy_version TEXT NOT NULL,
        status TEXT NOT NULL, maximum_estimated_tokens INTEGER NOT NULL, delivered_estimated_tokens INTEGER NOT NULL DEFAULT 0,
        active_estimated_tokens INTEGER NOT NULL DEFAULT 0, remaining_estimated_tokens INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
        CHECK (status IN ('planning','active','checkpointed','completed','failed','cancelled')),
        CHECK (maximum_estimated_tokens >= 0 AND delivered_estimated_tokens >= 0 AND active_estimated_tokens >= 0 AND remaining_estimated_tokens >= 0 AND remaining_estimated_tokens <= maximum_estimated_tokens),
        CHECK ((snapshot_kind = 'commit' AND worktree_hash IS NULL) OR (snapshot_kind = 'worktree' AND worktree_hash IS NOT NULL))
      );
      CREATE TABLE context_session_deliveries (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES context_sessions(id), sequence_number INTEGER NOT NULL,
        stage TEXT NOT NULL, trigger_json TEXT NOT NULL, reason TEXT NOT NULL, estimated_new_tokens INTEGER NOT NULL,
        estimated_restored_tokens INTEGER NOT NULL DEFAULT 0, estimated_duplicate_tokens_avoided INTEGER NOT NULL DEFAULT 0,
        coverage_added_json TEXT NOT NULL, coverage_remaining_json TEXT NOT NULL, strategy_id TEXT NOT NULL, strategy_version TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(session_id, sequence_number)
      );
      CREATE TABLE context_session_delivery_items (
        delivery_id TEXT NOT NULL REFERENCES context_session_deliveries(id), context_item_version_id TEXT NOT NULL REFERENCES context_item_versions(id),
        delivery_role TEXT NOT NULL, estimated_tokens INTEGER NOT NULL, content_hash TEXT NOT NULL, presence_state TEXT NOT NULL,
        duplicate_of_delivery_id TEXT, omission_reason TEXT, PRIMARY KEY(delivery_id, context_item_version_id, delivery_role),
        CHECK (delivery_role IN ('new','active_reference','restored','omitted'))
      );
      CREATE TABLE context_presence_transitions (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES context_sessions(id), context_item_version_id TEXT NOT NULL REFERENCES context_item_versions(id),
        previous_state TEXT, new_state TEXT NOT NULL, reason TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE context_session_signals (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES context_sessions(id), signal_type TEXT NOT NULL, signal_json TEXT NOT NULL, decision_json TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX idx_context_sessions_repository ON context_sessions(repository_id, created_at);
      CREATE INDEX idx_context_session_deliveries_session ON context_session_deliveries(session_id, sequence_number);
      CREATE INDEX idx_context_presence_session ON context_presence_transitions(session_id, created_at);
    `,
  },
  {
    version: 6,
    description: "Codex App Server shadow executions and flight-recorder evidence",
    sql: `
      CREATE TABLE codex_executions (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES context_sessions(id), repository_id INTEGER NOT NULL REFERENCES repositories(id), run_id TEXT REFERENCES agent_runs(id),
        task_text TEXT NOT NULL, codex_thread_id TEXT, codex_turn_id TEXT, codex_version TEXT NOT NULL, model TEXT, mode TEXT NOT NULL,
        approval_configuration TEXT NOT NULL, sandbox_configuration TEXT NOT NULL, base_commit_hash TEXT NOT NULL, worktree_hash TEXT,
        final_base_commit_hash TEXT, final_worktree_hash TEXT, repository_changed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
        started_at TEXT NOT NULL, completed_at TEXT, failure_code TEXT, failure_message TEXT,
        CHECK(mode='shadow'), CHECK(repository_changed IN(0,1))
      );
      CREATE INDEX idx_codex_executions_repository ON codex_executions(repository_id,started_at DESC);
      CREATE TABLE codex_raw_events (
        execution_id TEXT NOT NULL REFERENCES codex_executions(id), sequence_number INTEGER NOT NULL, direction TEXT NOT NULL,
        message_category TEXT NOT NULL, method TEXT, request_id TEXT, thread_id TEXT, turn_id TEXT, item_id TEXT,
        timestamp TEXT NOT NULL, raw_json TEXT NOT NULL, PRIMARY KEY(execution_id,sequence_number)
      );
      CREATE TABLE codex_normalized_events (
        id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES codex_executions(id), raw_sequence_number INTEGER NOT NULL,
        event_type TEXT NOT NULL, evidence_type TEXT NOT NULL, confidence TEXT NOT NULL, thread_id TEXT, turn_id TEXT, item_id TEXT,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(execution_id,raw_sequence_number) REFERENCES codex_raw_events(execution_id,sequence_number)
      );
      CREATE INDEX idx_codex_normalized_execution ON codex_normalized_events(execution_id,raw_sequence_number);
      CREATE TABLE codex_usage_snapshots (
        id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES codex_executions(id), raw_sequence_number INTEGER NOT NULL,
        source TEXT NOT NULL, input_tokens INTEGER, cached_input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
        total_tokens INTEGER, accumulation TEXT NOT NULL, measurement TEXT NOT NULL, timestamp TEXT NOT NULL, raw_provider_payload_json TEXT NOT NULL,
        CHECK(accumulation IN('accumulated','per_response')), CHECK(measurement IN('measured','estimated','unavailable')),
        FOREIGN KEY(execution_id,raw_sequence_number) REFERENCES codex_raw_events(execution_id,sequence_number)
      );
      CREATE TABLE codex_turn_diffs (
        id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES codex_executions(id), raw_sequence_number INTEGER NOT NULL,
        turn_id TEXT, content_hash TEXT NOT NULL, diff_text TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(execution_id,turn_id,content_hash), FOREIGN KEY(execution_id,raw_sequence_number) REFERENCES codex_raw_events(execution_id,sequence_number)
      );
      CREATE TRIGGER codex_raw_events_no_update BEFORE UPDATE ON codex_raw_events BEGIN SELECT RAISE(ABORT,'codex raw event ledger is append-only'); END;
      CREATE TRIGGER codex_raw_events_no_delete BEFORE DELETE ON codex_raw_events BEGIN SELECT RAISE(ABORT,'codex raw event ledger is append-only'); END;
      CREATE TRIGGER codex_normalized_events_no_update BEFORE UPDATE ON codex_normalized_events BEGIN SELECT RAISE(ABORT,'codex normalized event ledger is append-only'); END;
      CREATE TRIGGER codex_normalized_events_no_delete BEFORE DELETE ON codex_normalized_events BEGIN SELECT RAISE(ABORT,'codex normalized event ledger is append-only'); END;
      CREATE TRIGGER codex_usage_snapshots_no_update BEFORE UPDATE ON codex_usage_snapshots BEGIN SELECT RAISE(ABORT,'codex usage ledger is append-only'); END;
      CREATE TRIGGER codex_usage_snapshots_no_delete BEFORE DELETE ON codex_usage_snapshots BEGIN SELECT RAISE(ABORT,'codex usage ledger is append-only'); END;
      CREATE TRIGGER codex_turn_diffs_no_update BEFORE UPDATE ON codex_turn_diffs BEGIN SELECT RAISE(ABORT,'codex diff ledger is append-only'); END;
      CREATE TRIGGER codex_turn_diffs_no_delete BEFORE DELETE ON codex_turn_diffs BEGIN SELECT RAISE(ABORT,'codex diff ledger is append-only'); END;
    `,
  },
  {
    version: 7,
    description: "Per-item delivery evidence and snapshot availability tracking",
    sql: `
      -- Add per-item evidence columns to context_session_delivery_items.
      -- Legacy rows (before this migration) receive 'unknown_legacy' defaults.
      -- These columns are nullable so the PRIMARY KEY composite can remain unchanged.
      ALTER TABLE context_session_delivery_items ADD COLUMN requirement_state TEXT NOT NULL DEFAULT 'unknown_legacy';
      ALTER TABLE context_session_delivery_items ADD COLUMN coverage_categories_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE context_session_delivery_items ADD COLUMN packet_section TEXT NOT NULL DEFAULT 'unknown_legacy';
      ALTER TABLE context_session_delivery_items ADD COLUMN selection_reasons_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE context_session_delivery_items ADD COLUMN exact_match_reason TEXT;
      ALTER TABLE context_session_delivery_items ADD COLUMN relationship_reason TEXT;
      ALTER TABLE context_session_delivery_items ADD COLUMN coverage_reason TEXT;

      -- Add snapshot availability tracking to codex_executions.
      -- final_snapshot_available tracks whether final snapshot resolution succeeded.
      -- final_snapshot_error records a sanitized error message when resolution fails.
      ALTER TABLE codex_executions ADD COLUMN final_snapshot_available INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE codex_executions ADD COLUMN final_snapshot_error TEXT;
    `,
  },
  {
    version: 8,
    description: "Phase 4B Assist Runtime and Comparison Execution",
    requiresForeignKeysOff: true,
    sql: `
      -- Rewrite codex_executions to allow mode='assist'
      CREATE TABLE codex_executions_new (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES context_sessions(id), repository_id INTEGER NOT NULL REFERENCES repositories(id), run_id TEXT REFERENCES agent_runs(id),
        task_text TEXT NOT NULL, codex_thread_id TEXT, codex_turn_id TEXT, codex_version TEXT NOT NULL, model TEXT, mode TEXT NOT NULL,
        approval_configuration TEXT NOT NULL, sandbox_configuration TEXT NOT NULL, base_commit_hash TEXT NOT NULL, worktree_hash TEXT,
        final_base_commit_hash TEXT, final_worktree_hash TEXT, repository_changed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
        started_at TEXT NOT NULL, completed_at TEXT, failure_code TEXT, failure_message TEXT,
        final_snapshot_available INTEGER NOT NULL DEFAULT 1, final_snapshot_error TEXT,
        CHECK(mode IN ('shadow', 'assist')), CHECK(repository_changed IN(0,1))
      );
      
      INSERT INTO codex_executions_new SELECT * FROM codex_executions;
      DROP TABLE codex_executions;
      ALTER TABLE codex_executions_new RENAME TO codex_executions;
      
      CREATE INDEX idx_codex_executions_repository ON codex_executions(repository_id,started_at DESC);
      
      -- Add codex_comparison_runs table
      CREATE TABLE codex_comparison_runs (
        id TEXT PRIMARY KEY,
        repository_id INTEGER NOT NULL REFERENCES repositories(id),
        task_text TEXT NOT NULL,
        shadow_execution_id TEXT REFERENCES codex_executions(id),
        assist_execution_id TEXT REFERENCES codex_executions(id),
        verifier_command TEXT NOT NULL,
        shadow_exit_code INTEGER,
        assist_exit_code INTEGER,
        shadow_stdout_path TEXT,
        shadow_stderr_path TEXT,
        assist_stdout_path TEXT,
        assist_stderr_path TEXT,
        outcome TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 9,
    description: "Phase 4B.1 Codex Assist Tool Events and Injections",
    sql: `
      CREATE TABLE IF NOT EXISTS codex_assist_tool_call_events (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES codex_executions(id),
        tool_name TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        response_success INTEGER NOT NULL,
        response_content_items_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS codex_assist_injections (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES codex_executions(id),
        context_session_id TEXT NOT NULL REFERENCES context_sessions(id),
        injection_sequence INTEGER NOT NULL,
        envelope_size_bytes INTEGER NOT NULL,
        source_role TEXT NOT NULL
      );
    `,
  },
  {
    version: 10,
    description: "Phase 4B.2 assist evidence envelopes and comparison artifacts",
    sql: `
      ALTER TABLE codex_assist_injections ADD COLUMN serialized_envelope TEXT;
      ALTER TABLE codex_assist_injections ADD COLUMN envelope_sha256 TEXT;
      ALTER TABLE codex_assist_injections ADD COLUMN schema_version TEXT;
      ALTER TABLE codex_assist_injections ADD COLUMN delivery_id TEXT;
      ALTER TABLE codex_assist_injections ADD COLUMN estimated_tokens INTEGER;
      ALTER TABLE codex_assist_injections ADD COLUMN created_at TEXT;
      CREATE TABLE codex_comparison_artifacts (
        comparison_id TEXT NOT NULL REFERENCES codex_comparison_runs(id),
        mode TEXT NOT NULL CHECK(mode IN ('shadow','assist')),
        execution_id TEXT NOT NULL,
        report_schema_version TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(comparison_id,mode)
      );
      CREATE TRIGGER codex_comparison_artifacts_no_update BEFORE UPDATE ON codex_comparison_artifacts BEGIN SELECT RAISE(ABORT,'comparison artifacts are append-only'); END;
      CREATE TRIGGER codex_comparison_artifacts_no_delete BEFORE DELETE ON codex_comparison_artifacts BEGIN SELECT RAISE(ABORT,'comparison artifacts are append-only'); END;
    `,
  },
];
