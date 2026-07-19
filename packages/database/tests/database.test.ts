import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDatabase, migrate, getSchemaVersion } from "../src/connection.js";
import {
  RunRepository,
  RepositoryRepository,
} from "../src/run-repository.js";
import {
  EventRepository,
  GitSnapshotRepository,
  FileChangeRepository,
  TestRunRepository,
  UsageMetricRepository,
  UserOutcomeRepository,
} from "../src/event-repository.js";
import type { Db } from "../src/connection.js";

let tmpDir: string;
let db: Db;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "continuum-db-test-"));
  db = openDatabase(join(tmpDir, "test.db"));
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("migrate", () => {
  it("creates schema_migrations table", () => {
    const row = db
      .prepare("SELECT COUNT(*) as count FROM schema_migrations")
      .get() as { count: number };
    expect(row.count).toBeGreaterThanOrEqual(1);
  });

  it("returns the correct schema version", () => {
    expect(getSchemaVersion(db)).toBe(9);
  });

  it("is idempotent when run twice", () => {
    expect(() => migrate(db)).not.toThrow();
    expect(getSchemaVersion(db)).toBe(9);
  });
});

describe("RepositoryRepository", () => {
  it("creates and retrieves a repository", () => {
    const repo = new RepositoryRepository(db);
    const created = repo.upsert("/home/user/project", "project");
    expect(created.canonical_path).toBe("/home/user/project");
    expect(created.name).toBe("project");
  });

  it("returns the same id on upsert", () => {
    const repo = new RepositoryRepository(db);
    const a = repo.upsert("/home/user/project", "project");
    const b = repo.upsert("/home/user/project", "project");
    expect(a.id).toBe(b.id);
  });
});

describe("RunRepository", () => {
  let repoId: number;

  beforeEach(() => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/home/user/project", "project");
    repoId = repo.id;
  });

  it("creates a run and retrieves it by id", () => {
    const runRepo = new RunRepository(db);
    runRepo.create({
      id: "run-001",
      repositoryId: repoId,
      agentId: "gemini",
      task: "Fix the bug",
    });
    const found = runRepo.findById("run-001");
    expect(found).not.toBeNull();
    expect(found?.task).toBe("Fix the bug");
    expect(found?.status).toBe("running");
  });

  it("finishes a run and updates status", () => {
    const runRepo = new RunRepository(db);
    runRepo.create({
      id: "run-002",
      repositoryId: repoId,
      agentId: "gemini",
      task: "Fix the bug",
    });
    runRepo.finish({ id: "run-002", status: "completed", exitCode: 0 });
    const found = runRepo.findById("run-002");
    expect(found?.status).toBe("completed");
    expect(found?.exit_code).toBe(0);
  });

  it("findLatest returns most recent run", async () => {
    const runRepo = new RunRepository(db);
    runRepo.create({ id: "run-a", repositoryId: repoId, agentId: "gemini", task: "A" });
    await new Promise(resolve => setTimeout(resolve, 5));
    runRepo.create({ id: "run-b", repositoryId: repoId, agentId: "gemini", task: "B" });
    const latest = runRepo.findLatest();
    expect(latest?.id).toBe("run-b");
  });
});

describe("EventRepository", () => {
  let repoId: number;

  beforeEach(() => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/home/user/project", "project");
    repoId = repo.id;
    const runRepo = new RunRepository(db);
    runRepo.create({ id: "run-evt", repositoryId: repoId, agentId: "fake", task: "T" });
  });

  it("inserts and retrieves events in order", () => {
    const eventRepo = new EventRepository(db);
    const baseEvent = {
      runId: "run-evt",
      timestamp: new Date().toISOString(),
      source: "stdout" as const,
      redactionApplied: false,
    };
    eventRepo.insert(
      {
        ...baseEvent,
        eventId: "e1",
        sequenceNumber: 1,
        eventType: "stdout",
        payload: { line: "Hello world" },
      },
      false,
    );
    eventRepo.insert(
      {
        ...baseEvent,
        eventId: "e2",
        sequenceNumber: 2,
        eventType: "stdout",
        payload: { line: "Second line" },
      },
      false,
    );
    const events = eventRepo.findByRunId("run-evt");
    expect(events).toHaveLength(2);
    expect(events[0]?.sequence_number).toBe(1);
    expect(events[1]?.sequence_number).toBe(2);
  });

  it("counts events correctly", () => {
    const eventRepo = new EventRepository(db);
    const base = {
      runId: "run-evt",
      timestamp: new Date().toISOString(),
      source: "stdout" as const,
      redactionApplied: false,
    };
    eventRepo.insertBatch(
      [
        { ...base, eventId: "x1", sequenceNumber: 1, eventType: "stdout", payload: { line: "a" } },
        { ...base, eventId: "x2", sequenceNumber: 2, eventType: "agent_message", payload: { text: "b", raw: "b" } },
      ],
      false,
    );
    expect(eventRepo.countByRunId("run-evt")).toBe(2);
    expect(eventRepo.countByType("run-evt", "stdout")).toBe(1);
  });
});

describe("GitSnapshotRepository", () => {
  beforeEach(() => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/home/user/project", "project");
    const runRepo = new RunRepository(db);
    runRepo.create({ id: "run-git", repositoryId: repo.id, agentId: "fake", task: "T" });
  });

  it("inserts and retrieves snapshots", () => {
    const snapRepo = new GitSnapshotRepository(db);
    snapRepo.insert("run-git", "before", "abc123", "main", "M file.ts\n", new Date().toISOString());
    snapRepo.insert("run-git", "after", "def456", "main", "", new Date().toISOString());

    const before = snapRepo.findByPhase("run-git", "before");
    expect(before?.commit_hash).toBe("abc123");

    const all = snapRepo.findByRunId("run-git");
    expect(all).toHaveLength(2);
  });
});

describe("UserOutcomeRepository", () => {
  beforeEach(() => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/home/user/project", "project");
    const runRepo = new RunRepository(db);
    runRepo.create({ id: "run-out", repositoryId: repo.id, agentId: "fake", task: "T" });
  });

  it("upserts and retrieves outcome", () => {
    const outcomeRepo = new UserOutcomeRepository(db);
    outcomeRepo.upsert({
      runId: "run-out",
      status: "accepted",
      notes: "Looks great",
      createdAt: new Date().toISOString(),
    });
    const found = outcomeRepo.findByRunId("run-out");
    expect(found?.status).toBe("accepted");
    expect(found?.notes).toBe("Looks great");
  });
});

describe("TestRunRepository", () => {
  beforeEach(() => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/home/user/project", "project");
    const runRepo = new RunRepository(db);
    runRepo.create({ id: "run-tst", repositoryId: repo.id, agentId: "fake", task: "T" });
  });

  it("inserts and retrieves test runs", () => {
    const testRepo = new TestRunRepository(db);
    testRepo.insert({
      runId: "run-tst",
      phase: "baseline",
      command: "pnpm test",
      workingDirectory: "/project",
      startedAt: new Date().toISOString(),
      exitCode: 1,
    });
    const found = testRepo.findByRunId("run-tst");
    expect(found).toHaveLength(1);
    expect(found[0]?.exit_code).toBe(1);
    expect(found[0]?.phase).toBe("baseline");
  });
});

describe("UsageMetricRepository", () => {
  beforeEach(() => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/home/user/project", "project");
    const runRepo = new RunRepository(db);
    runRepo.create({ id: "run-met", repositoryId: repo.id, agentId: "fake", task: "T" });
  });

  it("inserts and retrieves metrics", () => {
    const metRepo = new UsageMetricRepository(db);
    metRepo.insert({ runId: "run-met", metricName: "input_tokens", numericValue: 1200, unit: "tokens" });
    const found = metRepo.findByRunId("run-met");
    expect(found).toHaveLength(1);
    expect(found[0]?.numeric_value).toBe(1200);
    expect(found[0]?.metric_name).toBe("input_tokens");
  });
});


describe("Codex flight-recorder migration", () => {
  it("creates append-only evidence ledgers", () => {
    const at = new Date().toISOString();
    const repository = new RepositoryRepository(db).upsert("/tmp/codex-ledger", "codex-ledger");
    db.prepare(`INSERT INTO context_sessions(id,repository_id,run_id,task_text,task_analysis_json,snapshot_kind,base_commit_hash,worktree_hash,strategy_id,strategy_version,status,maximum_estimated_tokens,delivered_estimated_tokens,active_estimated_tokens,remaining_estimated_tokens,created_at,updated_at,completed_at) VALUES(?,?,NULL,?,'{}','commit',?,NULL,'test','1','completed',100,0,0,100,?,?,?)`).run("session-codex",repository.id,"task","abc",at,at,at);
    db.prepare(`INSERT INTO codex_executions(id,session_id,repository_id,run_id,task_text,codex_thread_id,codex_turn_id,codex_version,model,mode,approval_configuration,sandbox_configuration,base_commit_hash,worktree_hash,final_base_commit_hash,final_worktree_hash,repository_changed,status,started_at,completed_at,failure_code,failure_message) VALUES(?,?,?,NULL,?,NULL,NULL,?,NULL,'shadow','never','read-only',?,NULL,NULL,NULL,0,'running',?,NULL,NULL,NULL)`).run("execution-codex","session-codex",repository.id,"task","0.133.0","abc",at);
    db.prepare(`INSERT INTO codex_raw_events(execution_id,sequence_number,direction,message_category,method,request_id,thread_id,turn_id,item_id,timestamp,raw_json) VALUES(?,1,'server_to_client','notification','turn/started',NULL,NULL,NULL,NULL,?,'{}')`).run("execution-codex",at);
    expect(() => db.prepare("UPDATE codex_raw_events SET raw_json='changed' WHERE execution_id=?").run("execution-codex")).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM codex_raw_events WHERE execution_id=?").run("execution-codex")).toThrow(/append-only/);
  });
});
