/**
 * PHASE 4A.2 REGRESSION — Mixed delivery item requirement states
 *
 * This test demonstrates the current bug:
 * When an orientation delivery contains items from different coverage categories
 * with different requirement states (required / recommended / optional), the
 * current report.ts incorrectly assigns the delivery-level aggregate
 * coverage_added_json to all items equally.
 *
 * The correct behaviour is:
 *   SECURITY.md         → requirementState=required,  mandatory=true,  packetSection=mandatory_contracts_constraints
 *   src/auth-service.ts → requirementState=required,  mandatory=true,  packetSection=exact_implementation
 *   tests/auth.test.ts  → requirementState=recommended, mandatory=false, packetSection=directly_related_tests
 *   docs/arch.md        → requirementState=not_applicable, mandatory=false, packetSection=optional_context
 *
 * Before production changes this test must FAIL for the right reason.
 * After production changes this test must PASS.
 */
import { describe, expect, it } from "vitest";
import { openDatabase, migrate, type Db } from "@continuum/database";
import { buildShadowReport, SHADOW_REPORT_SCHEMA_VERSION } from "../src/report.js";

// ─── helpers ─────────────────────────────────────────────────────────────────
function openDb(): Db { const db = openDatabase(":memory:"); migrate(db); return db; }

function insertRepository(db: Db): number {
  db.exec(`INSERT INTO repositories(canonical_path,name,created_at,updated_at) VALUES('/repo','testrepo','2024-01-01T00:00:00Z','2024-01-01T00:00:00Z')`);
  return (db.prepare("SELECT last_insert_rowid() id").get() as any).id;
}

function insertIndexRun(db: Db, repoId: number, hash = "abc1234"): void {
  db.exec(`INSERT INTO repository_index_runs(id,repository_id,snapshot_kind,base_commit_hash,started_at,status) VALUES('idx-1',${repoId},'commit','${hash}','2024-01-01T00:00:00Z','completed')`);
}

function insertContextItem(db: Db, repoId: number, id: string, versionId: string, sourcePath: string, content: string): void {
  db.exec(`INSERT INTO context_items(id,repository_id,kind,logical_key,created_at) VALUES('${id}',${repoId},'function','${sourcePath}','2024-01-01T00:00:00Z')`);
  db.exec(`INSERT INTO context_item_versions(id,context_item_id,content,source_path,source_start_line,source_end_line,language,content_hash,source_blob_hash,valid_from_commit,indexed_at,staleness_status) VALUES('${versionId}','${id}','${content}','${sourcePath}',1,1,'typescript','h${versionId}','h${versionId}','abc1234','2024-01-01T00:00:00Z','current')`);
}

/**
 * Build a database with a mixed-requirement-state orientation delivery.
 * Four items, four different requirement states / packet sections.
 */
function buildMixedDeliveryFixture(db: Db): void {
  const repoId = insertRepository(db);
  insertIndexRun(db, repoId);

  // Task analysis with all four coverage categories at different states
  const taskAnalysis = {
    originalTask: "Fix auth service", normalizedTask: "Fix auth service",
    taskClass: "local_bug", classificationReasons: [], mentionedPaths: [],
    mentionedSymbols: [], mentionedPackages: [], keywords: ["auth"],
    likelyLanguages: ["typescript"],
    requiredCoverage: [
      { category: "security_constraint", state: "required",    required: true,  reason: "test" },
      { category: "implementation",      state: "required",    required: true,  reason: "test" },
      { category: "tests",               state: "recommended", required: false, reason: "test" },
      { category: "documentation",       state: "not_applicable", required: false, reason: "test" },
    ],
    riskLevel: "high", riskReasons: [], estimatedComplexity: "local",
  };

  db.exec(`INSERT INTO agent_runs(id,repository_id,agent_id,task,status,output_mode,started_at) VALUES('run-1',${repoId},'codex','Fix auth service','completed','unknown','2024-01-01T00:00:00Z')`);

  // Four context items
  insertContextItem(db, repoId, "ci-sec", "cv-sec", "SECURITY.md", "security constraints");
  insertContextItem(db, repoId, "ci-impl", "cv-impl", "src/auth-service.ts", "auth implementation");
  insertContextItem(db, repoId, "ci-test", "cv-test", "tests/auth.test.ts", "auth tests");
  insertContextItem(db, repoId, "ci-docs", "cv-docs", "docs/arch.md", "architecture docs");

  // Context session
  db.exec(`INSERT INTO context_sessions(id,repository_id,run_id,task_text,task_analysis_json,snapshot_kind,base_commit_hash,strategy_id,strategy_version,status,maximum_estimated_tokens,remaining_estimated_tokens,created_at,updated_at) VALUES('sess-1',${repoId},'run-1','Fix auth service','${JSON.stringify(taskAnalysis).replace(/'/g,"''")}','commit','abc1234','deterministic','v1','completed',4000,4000,'2024-01-01T00:00:00Z','2024-01-01T00:00:10Z')`);

  // One orientation delivery with all four items
  // The delivery-level coverage_added_json contains ALL categories — this is the bug source
  const deliveryCoverage = JSON.stringify(["security_constraint","implementation","tests","documentation"]);
  db.exec(`INSERT INTO context_session_deliveries(id,session_id,sequence_number,stage,trigger_json,reason,estimated_new_tokens,coverage_added_json,coverage_remaining_json,strategy_id,strategy_version,created_at) VALUES('del-1','sess-1',1,'orientation','"initial"','Initial delivery',400,'${deliveryCoverage}','[]','deterministic','v1','2024-01-01T00:00:01Z')`);

  // Insert delivery items — each from a different section with different requirement states
  db.exec(`INSERT INTO context_session_delivery_items(delivery_id,context_item_version_id,delivery_role,estimated_tokens,content_hash,presence_state,requirement_state,packet_section,coverage_categories_json) VALUES('del-1','cv-sec','new',80,'h-sec','active','required','mandatory_contracts_constraints','["security_constraint"]')`);
  db.exec(`INSERT INTO context_session_delivery_items(delivery_id,context_item_version_id,delivery_role,estimated_tokens,content_hash,presence_state,requirement_state,packet_section,coverage_categories_json) VALUES('del-1','cv-impl','new',120,'h-impl','active','required','exact_implementation','["implementation"]')`);
  db.exec(`INSERT INTO context_session_delivery_items(delivery_id,context_item_version_id,delivery_role,estimated_tokens,content_hash,presence_state,requirement_state,packet_section,coverage_categories_json) VALUES('del-1','cv-test','new',100,'h-test','active','recommended','directly_related_tests','["tests"]')`);
  db.exec(`INSERT INTO context_session_delivery_items(delivery_id,context_item_version_id,delivery_role,estimated_tokens,content_hash,presence_state,requirement_state,packet_section,coverage_categories_json) VALUES('del-1','cv-docs','new',100,'h-docs','active','not_applicable','optional_context','["documentation"]')`);

  // Codex execution referencing this session
  db.exec(`INSERT INTO codex_executions(id,session_id,repository_id,task_text,codex_version,mode,approval_configuration,sandbox_configuration,base_commit_hash,status,started_at,completed_at,final_base_commit_hash) VALUES('exec-1','sess-1',${repoId},'Fix auth service','0.133.0','shadow','on-request','workspace-write','abc1234','completed','2024-01-01T00:00:00Z','2024-01-01T00:00:10Z','abc1234')`);

  // Minimal raw events for FK constraint
  db.exec(`INSERT INTO codex_raw_events(execution_id,sequence_number,direction,message_category,timestamp,raw_json) VALUES('exec-1',1,'server_to_client','notification','2024-01-01T00:00:01Z','{}')`);
  // One normalized file_edit event
  const fileEditPayload = JSON.stringify({ changes:[{path:"src/auth-service.ts",kind:"update"}],status:"completed" }).replace(/'/g,"''");
  db.exec(`INSERT INTO codex_normalized_events(id,execution_id,raw_sequence_number,event_type,evidence_type,confidence,payload_json,created_at) VALUES('ev-1','exec-1',1,'file_edit','directly observed','high','${fileEditPayload}','2024-01-01T00:00:01Z')`);
}

// ─── REGRESSION TESTS ────────────────────────────────────────────────────────
describe("Phase 4A.2 regression — mixed delivery requirement states", () => {
  /**
   * This test MUST FAIL before production changes.
   * After production changes it must PASS.
   *
   * The current implementation uses delivery-level coverage_added_json
   * to assign requirementState to all items. Since the delivery has
   * coverage_added_json = ["security_constraint","implementation","tests","documentation"],
   * it incorrectly makes ALL items mandatory = true (because the delivery contains a "required" category).
   */
  it("assigns per-item requirement states, not delivery-level aggregate", () => {
    const db = openDb();
    buildMixedDeliveryFixture(db);
    const report = buildShadowReport(db, "exec-1", "/repo");

    expect(report.schemaVersion).toBe(SHADOW_REPORT_SCHEMA_VERSION);

    const byPath = new Map(report.prediction.items.map(item => [item.path, item]));

    const security = byPath.get("SECURITY.md");
    const impl = byPath.get("src/auth-service.ts");
    const tests = byPath.get("tests/auth.test.ts");
    const docs = byPath.get("docs/arch.md");

    expect(security, "SECURITY.md must be in predicted items").toBeDefined();
    expect(impl, "src/auth-service.ts must be in predicted items").toBeDefined();
    expect(tests, "tests/auth.test.ts must be in predicted items").toBeDefined();
    expect(docs, "docs/arch.md must be in predicted items").toBeDefined();

    // ── Requirement states ────────────────────────────────────────────────
    expect(security!.requirementState, "SECURITY.md must be required").toBe("required");
    expect(impl!.requirementState, "src/auth-service.ts must be required").toBe("required");
    expect(tests!.requirementState, "tests/auth.test.ts must be recommended, not required").toBe("recommended");
    expect(docs!.requirementState, "docs/arch.md must not be required or recommended").not.toBe("required");

    // ── Mandatory flag ───────────────────────────────────────────────────
    expect(security!.mandatory, "SECURITY.md must be mandatory").toBe(true);
    expect(impl!.mandatory, "src/auth-service.ts must be mandatory").toBe(true);
    expect(tests!.mandatory, "tests/auth.test.ts must NOT be mandatory").toBe(false);
    expect(docs!.mandatory, "docs/arch.md must NOT be mandatory").toBe(false);

    // ── Per-item coverage categories (must NOT be the delivery aggregate) ─
    expect(security!.coverageCategories).toContain("security_constraint");
    expect(security!.coverageCategories).not.toContain("implementation");
    expect(security!.coverageCategories).not.toContain("tests");

    expect(impl!.coverageCategories).toContain("implementation");
    expect(impl!.coverageCategories).not.toContain("security_constraint");

    expect(tests!.coverageCategories).toContain("tests");
    expect(tests!.coverageCategories).not.toContain("implementation");

    // ── Packet sections ─────────────────────────────────────────────────
    expect(security!.packetSection, "SECURITY.md in mandatory section").toBe("mandatory_contracts_constraints");
    expect(impl!.packetSection, "auth-service.ts in exact_implementation section").toBe("exact_implementation");
    expect(tests!.packetSection, "auth.test.ts in directly_related_tests section").toBe("directly_related_tests");
    expect(docs!.packetSection, "arch.md in optional_context section").toBe("optional_context");
  });

  it("mandatoryPredictionMisses only counts items with requirementState=required", () => {
    const db = openDb();
    buildMixedDeliveryFixture(db);
    const report = buildShadowReport(db, "exec-1", "/repo");

    // src/auth-service.ts IS in editedPaths → NOT a miss
    // SECURITY.md is NOT edited → IS a miss (if required)
    // tests/auth.test.ts is NOT edited → NOT a miss (recommended, not required)
    // docs/arch.md is NOT edited → NOT a miss (not_applicable)

    const missPaths = (report.comparison.requiredPredictionsWithoutObservedActivity ?? report.comparison.mandatoryPredictionMisses as any[]).map((m: any) => m.path);

    expect(missPaths, "SECURITY.md must be a required-miss").toContain("SECURITY.md");
    expect(missPaths, "src/auth-service.ts must NOT be a miss (it was edited)").not.toContain("src/auth-service.ts");
    expect(missPaths, "tests/auth.test.ts must NOT be a miss (recommended, not required)").not.toContain("tests/auth.test.ts");
    expect(missPaths, "docs/arch.md must NOT be a miss (not required)").not.toContain("docs/arch.md");
  });

  it("coverage categories are per-item, not the delivery aggregate", () => {
    const db = openDb();
    buildMixedDeliveryFixture(db);
    const report = buildShadowReport(db, "exec-1", "/repo");

    // Verify that items do not inherit the full delivery coverage list
    const allCategories = report.prediction.items.flatMap(i => i.coverageCategories);
    // security_constraint and documentation should not both appear on the impl item
    const implItem = report.prediction.items.find(i => i.path === "src/auth-service.ts")!;
    expect(implItem.coverageCategories).not.toContain("security_constraint");
    expect(implItem.coverageCategories).not.toContain("documentation");
    expect(implItem.coverageCategories).not.toContain("tests");
  });
});
