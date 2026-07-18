import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  openDatabase,
  migrate,
  RunRepository,
  RepositoryRepository,
  EventRepository,
  GitSnapshotRepository,
  FileChangeRepository,
  UsageMetricRepository,
  UserOutcomeRepository,
} from "@continuum/database";
import type { Db } from "@continuum/database";
import { buildReport, compareRuns } from "../src/report.js";
import { generateEventId, now } from "@continuum/shared";

let tmpDir: string;
let db: Db;

function seedRun(id: string, repoId: number) {
  const runRepo = new RunRepository(db);
  runRepo.create({
    id,
    repositoryId: repoId,
    agentId: "fake",
    agentVersion: "0.0.0",
    task: "Fix the bug",
    branch: "main",
    startingCommit: "abc123",
  });
  runRepo.finish({
    id,
    status: "completed",
    exitCode: 0,
    endingCommit: "def456",
    outputMode: "stream-json",
    attributionConfidence: "high",
  });
}

function seedEvents(runId: string) {
  const eventRepo = new EventRepository(db);
  const base = {
    runId,
    timestamp: now(),
    source: "stdout" as const,
    redactionApplied: false,
  };
  eventRepo.insert(
    {
      ...base,
      eventId: generateEventId(),
      sequenceNumber: 1,
      eventType: "agent_init",
      payload: { sessionId: "s1", model: "fake-1.0", raw: "" },
    },
    false,
  );
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "continuum-eval-test-"));
  db = openDatabase(join(tmpDir, "test.db"));
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildReport", () => {
  it("builds a report for a completed run", () => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/project", "project");
    seedRun("run-report-1", repo.id);
    seedEvents("run-report-1");

    const report = buildReport("run-report-1", db);
    expect(report.runId).toBe("run-report-1");
    expect(report.task).toBe("Fix the bug");
    expect(report.status).toBe("completed");
    expect(report.agentId).toBe("fake");
    expect(report.totalEvents).toBe(1);
  });

  it("lists input_tokens as unavailable when not recorded", () => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/project", "project");
    seedRun("run-report-2", repo.id);

    const report = buildReport("run-report-2", db);
    expect(report.unavailableMetrics).toContain("Input tokens");
  });

  it("records input_tokens when available", () => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/project", "project");
    seedRun("run-report-3", repo.id);

    const usageRepo = new UsageMetricRepository(db);
    usageRepo.insert({
      runId: "run-report-3",
      metricName: "input_tokens",
      numericValue: 1500,
      unit: "tokens",
    });

    const report = buildReport("run-report-3", db);
    const tokenMetric = report.metrics.find((m) => m.name === "Input tokens");
    expect(tokenMetric?.value).toBe(1500);
    expect(tokenMetric?.quality).toBe("exact");
    expect(report.unavailableMetrics).not.toContain("Input tokens");
  });

  it("throws RunNotFoundError for missing run", () => {
    expect(() => buildReport("nonexistent-run", db)).toThrow("Run");
  });

  it("warns when no user outcome exists", () => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/project", "project");
    seedRun("run-report-4", repo.id);

    const report = buildReport("run-report-4", db);
    expect(report.warnings.some((w) => w.includes("outcome"))).toBe(true);
  });

  it("includes git snapshot attribution confidence in report", () => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/project", "project");
    seedRun("run-report-5", repo.id);

    const gitRepo = new GitSnapshotRepository(db);
    gitRepo.insert("run-report-5", "before", "abc", "main", "? dirty.ts\n", now());
    gitRepo.insert("run-report-5", "after", "def", "main", "", now());

    const report = buildReport("run-report-5", db);
    expect(report.warnings.some((w) => w.includes("untracked"))).toBe(true);
  });

  it("includes file change statistics", () => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/project", "project");
    seedRun("run-report-6", repo.id);

    const fileRepo = new FileChangeRepository(db);
    fileRepo.insertBatch("run-report-6", [
      { pathAfter: "src/calculator.ts", changeType: "modified", additions: 5, deletions: 2 },
      { pathAfter: "src/new-file.ts", changeType: "added", additions: 30, deletions: 0 },
    ]);

    const report = buildReport("run-report-6", db);
    expect(report.totalAdditions).toBe(35);
    expect(report.totalDeletions).toBe(2);
    expect(report.fileChanges).toHaveLength(2);
  });
});

describe("compareRuns", () => {
  it("compares two runs without crashing", () => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/project", "project");
    seedRun("run-cmp-a", repo.id);
    seedRun("run-cmp-b", repo.id);

    const comparison = compareRuns("run-cmp-a", "run-cmp-b", db);
    expect(comparison.runIdA).toBe("run-cmp-a");
    expect(comparison.runIdB).toBe("run-cmp-b");
    expect(comparison.summary.length).toBeGreaterThan(10);
  });

  it("does not claim an overall winner when evidence is limited", () => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/project", "project");
    seedRun("run-cmp-c", repo.id);
    seedRun("run-cmp-d", repo.id);

    const comparison = compareRuns("run-cmp-c", "run-cmp-d", db);
    expect(comparison.summary).toContain("No overall winner");
  });

  it("notes when one run has a user acceptance", () => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/project", "project");
    seedRun("run-cmp-e", repo.id);
    seedRun("run-cmp-f", repo.id);

    const outcomeRepo = new UserOutcomeRepository(db);
    outcomeRepo.upsert({ runId: "run-cmp-e", status: "accepted", createdAt: now() });

    const comparison = compareRuns("run-cmp-e", "run-cmp-f", db);
    expect(comparison.summary).toContain("accepted");
  });
  it("reports no baseline instead of a savings claim", () => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/project", "project");
    seedRun("run-cmp-no-baseline", repo.id);

    const report = buildReport("run-cmp-no-baseline", db);
    const duplicateMetric = report.metrics.find(
      (metric) => metric.name === "Potential duplicate context avoided",
    );
    expect(duplicateMetric?.note).toBe("No valid baseline");
    expect(report.metrics.some((metric) => /savings/i.test(metric.name))).toBe(false);
    expect(report.costEvidence.measurement).toBe("unavailable");
  });

  it("keeps cost, context, and retry dimensions separate", () => {
    const repoRepo = new RepositoryRepository(db);
    const repo = repoRepo.upsert("/project", "project");
    seedRun("run-cmp-foundation-a", repo.id);
    seedRun("run-cmp-foundation-b", repo.id);

    const comparison = compareRuns(
      "run-cmp-foundation-a",
      "run-cmp-foundation-b",
      db,
    );
    const categories = comparison.efficiency.map((item) => item.category);
    expect(categories).toContain("Total credits");
    expect(categories).toContain("Context supplied");
    expect(categories).toContain("Context packet size");
    expect(categories).toContain("Context delivery stages");
    expect(categories).toContain("Retries");
    expect(comparison.summary).toContain("No overall winner");
  });

});
