/**
 * Flight Recorder Correctness Tests — Phase 4A.1
 *
 * These tests prove that:
 * 1. buildShadowReport produces a v2 schema report, not v1.
 * 2. Edited paths and command-inferred paths are separate evidence buckets.
 * 3. Mandatory predicted items are only marked mandatory if they appear in "required" coverage.
 * 4. Comparison metrics (observationRecall, predictionPrecision) use correct denominators.
 * 5. Failed-run snapshot does not contain a fabricated database integer as a commit hash.
 * 6. searchedSymbols is populated from rg/grep command inferences.
 * 7. directlyObservedReadPaths is always empty (Codex schema does not expose reads).
 */
import { describe, expect, it } from "vitest";
import { openDatabase, migrate, type Db } from "@continuum/database";
import { buildShadowReport, SHADOW_REPORT_SCHEMA_VERSION } from "../src/report.js";

// ─── helpers ────────────────────────────────────────────────────────────────
function openDb(): Db {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

interface FixtureArgs {
  task?: string;
  status?: string;
  baseCommit?: string;
  patchFile?: boolean;
  applyRgCommand?: boolean;
  extraNormalizedEvents?: Array<{ eventType: string; evidenceType: string; confidence: string; payload: Record<string, unknown> }>;
  predictionCategories?: string[];
  requiredCategory?: string;
  /** Override mandatory requirement state to "recommended" for the first item */
  firstItemRecommended?: boolean;
}

/**
 * Build a minimal in-memory database seeded with a codex execution and all
 * associated tables, then return the report.
 */
function buildFixture(db: Db, args: FixtureArgs = {}) {
  const task = args.task ?? "Fix the add function";
  const baseCommit = args.baseCommit ?? "abc1234";
  const status = args.status ?? "completed";
  const coverageAdded = args.predictionCategories ?? ["implementation"];
  const requirementState = args.firstItemRecommended ? "recommended" : "required";

  // Insert repository
  db.exec(`INSERT INTO repositories(canonical_path,name,created_at,updated_at) VALUES('/repo','testrepo','2024-01-01T00:00:00Z','2024-01-01T00:00:00Z')`);
  const repoId: number = (db.prepare("SELECT last_insert_rowid() id").get() as any).id;

  // Build task analysis JSON
  const taskAnalysis = {
    originalTask: task, normalizedTask: task, taskClass: "local_bug",
    classificationReasons: [], mentionedPaths: [], mentionedSymbols: [],
    mentionedPackages: [], keywords: [], likelyLanguages: [],
    requiredCoverage: [{ category: "implementation", state: requirementState, required: requirementState === "required", reason: "test" }],
    riskLevel: "low", riskReasons: [], estimatedComplexity: "local",
  };

  // Insert agent_run
  db.exec(`INSERT INTO agent_runs(id,repository_id,agent_id,task,status,output_mode,started_at) VALUES('run-1',${repoId},'codex','${task}','completed','unknown','2024-01-01T00:00:00Z')`);

  // Insert context_session (used for repository_index_run reference)
  db.exec(`INSERT INTO repository_index_runs(id,repository_id,snapshot_kind,base_commit_hash,started_at,status) VALUES('idx-1',${repoId},'commit','${baseCommit}','2024-01-01T00:00:00Z','completed')`);

  // Insert context_session
  const sessionJson = JSON.stringify(taskAnalysis);
  db.exec(`INSERT INTO context_sessions(id,repository_id,run_id,task_text,task_analysis_json,snapshot_kind,base_commit_hash,strategy_id,strategy_version,status,maximum_estimated_tokens,remaining_estimated_tokens,created_at,updated_at) VALUES('sess-1',${repoId},'run-1','${task}','${sessionJson.replace(/'/g, "''")}','commit','${baseCommit}','deterministic','v1','completed',4000,4000,'2024-01-01T00:00:00Z','2024-01-01T00:00:10Z')`);

  // Insert context_items and context_item_versions for predicted items
  db.exec(`INSERT INTO context_items(id,repository_id,kind,logical_key,created_at) VALUES('ci-1',${repoId},'function','src/add.ts::add','2024-01-01T00:00:00Z')`);
  db.exec(`INSERT INTO context_item_versions(id,context_item_id,content,source_path,source_start_line,source_end_line,language,content_hash,source_blob_hash,valid_from_commit,indexed_at,staleness_status) VALUES('cv-1','ci-1','export const add = () => 0','src/add.ts',1,1,'typescript','hash1','hash1','${baseCommit}','2024-01-01T00:00:00Z','current')`);

  // Insert session delivery
  db.exec(`INSERT INTO context_session_deliveries(id,session_id,sequence_number,stage,trigger_json,reason,estimated_new_tokens,coverage_added_json,coverage_remaining_json,strategy_id,strategy_version,created_at) VALUES('del-1','sess-1',1,'orientation','"initial"','Initial delivery',100,'${JSON.stringify(coverageAdded).replace(/'/g, "''")}','[]','deterministic','v1','2024-01-01T00:00:01Z')`);
  db.exec(`INSERT INTO context_session_delivery_items(delivery_id,context_item_version_id,delivery_role,estimated_tokens,content_hash,presence_state) VALUES('del-1','cv-1','new',100,'hash1','active')`);

  // Insert codex execution
  const completedAt = status === "completed" ? "'2024-01-01T00:00:10Z'" : "NULL";
  const failureCode = status === "failed" ? "'TURN_FAILURE'" : "NULL";
  db.exec(`INSERT INTO codex_executions(id,session_id,repository_id,task_text,codex_version,mode,approval_configuration,sandbox_configuration,base_commit_hash,status,started_at,completed_at,failure_code,final_base_commit_hash) VALUES('exec-1','sess-1',${repoId},'${task}','0.133.0','shadow','on-request','workspace-write','${baseCommit}','${status}','2024-01-01T00:00:00Z',${completedAt},${failureCode},'${baseCommit}')`);

  // Insert raw events (required by FK constraints on normalized events)
  db.exec(`INSERT INTO codex_raw_events(execution_id,sequence_number,direction,message_category,timestamp,raw_json) VALUES('exec-1',1,'server_to_client','notification','2024-01-01T00:00:01Z','{}')`);
  db.exec(`INSERT INTO codex_raw_events(execution_id,sequence_number,direction,message_category,timestamp,raw_json) VALUES('exec-1',2,'server_to_client','notification','2024-01-01T00:00:02Z','{}')`);
  db.exec(`INSERT INTO codex_raw_events(execution_id,sequence_number,direction,message_category,timestamp,raw_json) VALUES('exec-1',3,'server_to_client','notification','2024-01-01T00:00:03Z','{}')`);

  // Insert normalized events
  // file_edit event: Codex modified src/add.ts
  const fileEditPayload = JSON.stringify({ changes: [{ path: "src/add.ts", kind: "update" }], status: "completed" }).replace(/'/g, "''");
  db.exec(`INSERT INTO codex_normalized_events(id,execution_id,raw_sequence_number,event_type,evidence_type,confidence,payload_json,created_at) VALUES('ev-1','exec-1',1,'file_edit','directly observed','high','${fileEditPayload}','2024-01-01T00:00:01Z')`);

  // command_execution event: test command, infers paths
  const cmdPayload = JSON.stringify({ command: "pnpm test", cwd: "/repo", exitCode: 0, durationMs: 42, status: "completed", source: "agent" }).replace(/'/g, "''");
  db.exec(`INSERT INTO codex_normalized_events(id,execution_id,raw_sequence_number,event_type,evidence_type,confidence,payload_json,created_at) VALUES('ev-2','exec-1',2,'command_execution','directly observed','high','${cmdPayload}','2024-01-01T00:00:02Z')`);

  if (args.applyRgCommand) {
    // repository_search event from rg — should populate searchedSymbols
    const rgPayload = JSON.stringify({ command: "rg 'DiscoveryService' src", path: "src", cwd: "/repo" }).replace(/'/g, "''");
    db.exec(`INSERT INTO codex_normalized_events(id,execution_id,raw_sequence_number,event_type,evidence_type,confidence,payload_json,created_at) VALUES('ev-3','exec-1',3,'repository_search','command-inferred','medium','${rgPayload}','2024-01-01T00:00:03Z')`);
  } else {
    // file_read_evidence inferred from a cat command
    const readPayload = JSON.stringify({ path: "tests/add.test.ts", command: "cat tests/add.test.ts" }).replace(/'/g, "''");
    db.exec(`INSERT INTO codex_normalized_events(id,execution_id,raw_sequence_number,event_type,evidence_type,confidence,payload_json,created_at) VALUES('ev-3','exec-1',3,'file_read_evidence','command-inferred','medium','${readPayload}','2024-01-01T00:00:03Z')`);
  }

  // usage snapshot
  db.exec(`INSERT INTO codex_usage_snapshots(id,execution_id,raw_sequence_number,source,input_tokens,output_tokens,total_tokens,accumulation,measurement,timestamp,raw_provider_payload_json) VALUES('us-1','exec-1',1,'codex',100,50,150,'accumulated','measured','2024-01-01T00:00:09Z','{}')`);
}

// ─── tests ───────────────────────────────────────────────────────────────────
describe("Flight Recorder correctness — Phase 4A.1", () => {
  it("produces schema v2, not v1", () => {
    const db = openDb();
    buildFixture(db);
    const report = buildShadowReport(db, "exec-1", "/repo");
    expect(report.schemaVersion).toBe(SHADOW_REPORT_SCHEMA_VERSION);
    expect(report.schemaVersion).toBe("continuum.shadow-flight-recorder.v2");
  });

  it("separates editedPaths from commandInferredReadPaths", () => {
    const db = openDb();
    buildFixture(db); // normal fixture uses cat, not rg
    const report = buildShadowReport(db, "exec-1", "/repo");
    // src/add.ts was edited
    expect(report.exploration.editedPaths).toContain("src/add.ts");
    // tests/add.test.ts was inferred from cat command
    expect(report.exploration.commandInferredReadPaths).toContain("tests/add.test.ts");
    // No overlap between the two buckets
    const editedSet = new Set(report.exploration.editedPaths);
    for (const p of report.exploration.commandInferredReadPaths) {
      expect(editedSet.has(p)).toBe(false);
    }
    // directlyObservedReadPaths must always be empty
    expect(report.exploration.directlyObservedReadPaths).toHaveLength(0);
  });

  it("marks items mandatory only when requirementState is required", () => {
    const db = openDb();
    buildFixture(db); // first item defaults to "required"
    const report = buildShadowReport(db, "exec-1", "/repo");
    expect(report.prediction.items.length).toBeGreaterThan(0);
    const mandatoryItems = report.prediction.items.filter((item) => item.mandatory);
    const requiredItems = report.prediction.items.filter((item) => item.requirementState === "required");
    // mandatory must exactly equal required
    expect(mandatoryItems.length).toBe(requiredItems.length);
  });

  it("marks items as non-mandatory when requirementState is recommended", () => {
    const db = openDb();
    buildFixture(db, { firstItemRecommended: true });
    const report = buildShadowReport(db, "exec-1", "/repo");
    expect(report.prediction.items.every((item) => !item.mandatory)).toBe(true);
    expect(report.prediction.items.every((item) => item.requirementState !== "required")).toBe(true);
  });

  it("observationRecall = overlap / |observed| — denominator is observed count", () => {
    const db = openDb();
    buildFixture(db); // src/add.ts edited, tests/add.test.ts inferred
    const report = buildShadowReport(db, "exec-1", "/repo");
    const observed = [
      ...report.exploration.editedPaths,
      ...report.exploration.commandInferredReadPaths,
      ...report.exploration.searchedPaths,
      ...report.exploration.diffPaths,
    ];
    const uniqueObserved = [...new Set(observed)];
    const predicted = report.prediction.items.map((item) => item.path);
    const overlap = predicted.filter((p) => uniqueObserved.includes(p)).length;
    const expectedRecall = uniqueObserved.length ? overlap / uniqueObserved.length : null;
    expect(report.comparison.observationRecall).toBe(expectedRecall);
  });

  it("predictionPrecision = overlap / |predicted| — denominator is predicted count", () => {
    const db = openDb();
    buildFixture(db);
    const report = buildShadowReport(db, "exec-1", "/repo");
    const observed = [...new Set([
      ...report.exploration.editedPaths,
      ...report.exploration.commandInferredReadPaths,
      ...report.exploration.searchedPaths,
      ...report.exploration.diffPaths,
    ])];
    const predicted = report.prediction.items.map((item) => item.path);
    const overlap = predicted.filter((p) => observed.includes(p)).length;
    const expectedPrecision = predicted.length ? overlap / predicted.length : null;
    expect(report.comparison.predictionPrecision).toBe(expectedPrecision);
  });

  it("mandatoryPredictionMisses only includes required items not in any evidence", () => {
    const db = openDb();
    // src/add.ts is predicted and edited — so it WILL be observed
    buildFixture(db); // predicted path "src/add.ts" is also edited
    const report = buildShadowReport(db, "exec-1", "/repo");
    // src/add.ts is in editedPaths, so it should NOT appear in mandatoryPredictionMisses
    expect(report.comparison.mandatoryPredictionMisses.every(
      (miss: any) => miss.path !== "src/add.ts"
    )).toBe(true);
  });

  it("searchedSymbols is populated from rg command inferences", () => {
    const db = openDb();
    buildFixture(db, { applyRgCommand: true }); // produces repository_search event with rg 'DiscoveryService' src
    const report = buildShadowReport(db, "exec-1", "/repo");
    expect(report.exploration.searchedSymbols).toContain("DiscoveryService");
  });

  it("searchedSymbols is empty when no rg commands were executed", () => {
    const db = openDb();
    buildFixture(db); // uses cat command, no rg
    const report = buildShadowReport(db, "exec-1", "/repo");
    expect(report.exploration.searchedSymbols).toHaveLength(0);
  });

  it("failed-run final snapshot commit hash is not the repository database integer ID", () => {
    const db = openDb();
    buildFixture(db, { status: "failed" });
    const report = buildShadowReport(db, "exec-1", "/repo");
    // The snapshot in the report comes from the execution row, not the repository ID
    const hash = report.execution.snapshot.base_commit_hash;
    // Must not be a short decimal integer string (repository DB ID)
    expect(/^\d{1,5}$/.test(hash)).toBe(false);
    // Must be the actual commit hash or SNAPSHOT_UNAVAILABLE
    expect(hash === "abc1234" || hash === "SNAPSHOT_UNAVAILABLE").toBe(true);
  });

  it("v1 compat fields changedPaths and directlyObservedPaths are still present", () => {
    const db = openDb();
    buildFixture(db);
    const report = buildShadowReport(db, "exec-1", "/repo");
    expect(Array.isArray(report.exploration.changedPaths)).toBe(true);
    expect(Array.isArray(report.exploration.directlyObservedPaths)).toBe(true);
    // changedPaths should equal editedPaths
    expect(report.exploration.changedPaths).toEqual(report.exploration.editedPaths);
  });

  it("usage availability is measured when accumulated snapshot exists", () => {
    const db = openDb();
    buildFixture(db);
    const report = buildShadowReport(db, "exec-1", "/repo");
    expect(report.usage.accumulated).not.toBeNull();
    expect(["measured", "partial"]).toContain(report.usage.availability);
  });
});
