import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";
import { ContextRepository, migrate, openDatabase, type Db } from "@continuum/database";
import { ContextEngine } from "../src/engine.js";
import { normalizeFtsBm25 } from "../src/semantic.js";

describe("ContextEngine", () => {
  let db: Db;
  let repository: ContextRepository;
  const path = join(tmpdir(), `continuum-context-engine-${process.pid}-${Date.now()}.db`);
  const snapshot = { snapshot_kind: "commit" as const, base_commit_hash: "abc123", worktree_hash: null, dirty: false };

  beforeEach(() => {
    db = openDatabase(path);
    migrate(db);
    db.prepare("INSERT INTO repositories(id, canonical_path, name, created_at, updated_at) VALUES(1, '/fixture', 'fixture', ?, ?)").run(new Date().toISOString(), new Date().toISOString());
    repository = new ContextRepository(db);
  });
  afterEach(() => { db.close(); try { unlinkSync(path); } catch { /* Windows may briefly retain the file. */ } });

  function add(id: string, logicalKey: string, symbol: string, sourcePath: string, content: string, kind = "function", status = "current", validTo: string | null = null): string {
    const item = repository.upsertContextItem(1, kind, logicalKey);
    repository.insertContextItemVersion({ id, context_item_id: item.id, content, contextual_header: `Repository: fixture\nFile: ${sourcePath}\nSymbol: ${symbol}`, compiled_content: `Repository: fixture\n\n${content}`, title: symbol, source_path: sourcePath, source_start_line: 1, source_end_line: 4, symbol_name: symbol, language: kind === "heading" ? "markdown" : "typescript", content_hash: `${id}-hash`, source_blob_hash: `${id}-blob`, valid_from_commit: "abc123", valid_to_commit_exclusive: validTo, indexed_at: new Date().toISOString(), provenance_json: JSON.stringify({ repositoryId: 1, sourcePath, sourceStartLine: 1, sourceEndLine: 4, extractor: "fixture", snapshot, confidence: "high" }), staleness_status: status, staleness_reason: null, metadata_json: JSON.stringify({ declarationKind: kind }) });
    return item.id;
  }

  it("normalizes stronger negative BM25 values higher", () => {
    expect(normalizeFtsBm25(-10)).toBeGreaterThan(normalizeFtsBm25(-1));
    expect(normalizeFtsBm25(1)).toBe(0);
  });

  it("boosts an exact symbol and excludes stale and historical versions", async () => {
    add("exact", "src/parser.ts:parseGeminiLine", "parseGeminiLine", "src/parser.ts", "export function parseGeminiLine() { return true; }");
    add("weak", "src/other.ts:other", "other", "src/other.ts", "// parseGeminiLine appears only in a weak body mention");
    add("stale", "src/stale.ts:parseGeminiLineOld", "parseGeminiLineOld", "src/stale.ts", "function parseGeminiLineOld() {}", "function", "stale");
    add("historical", "src/history.ts:parseGeminiLineHistory", "parseGeminiLineHistory", "src/history.ts", "function parseGeminiLineHistory() {}", "function", "current", "def456");
    const results = await new ContextEngine(db, 1, snapshot).search("Fix parseGeminiLine bug");
    expect(results[0]?.item.id).toBe("exact");
    expect(results[0]?.components.exactSymbol).toBeGreaterThan(0);
    expect(results.some((result) => result.item.id === "stale")).toBe(false);
    expect(results.some((result) => result.item.id === "historical")).toBe(false);
  });

  it("expands verified tests and creates a complete local-bug packet", async () => {
    const implementation = add("impl", "src/parser.ts:parseValue", "parseValue", "src/parser.ts", "export function parseValue() { return true; }");
    const test = add("test", "tests/parser.test.ts:parseValue test", "parseValue test", "tests/parser.test.ts", "test('parseValue', () => parseValue());", "test");
    repository.upsertRelationship({ id: "rel", sourceContextItemId: test, targetContextItemId: implementation, kind: "tests", confidence: "high", evidence: { sourcePath: "tests/parser.test.ts", description: "Direct import and symbol use." } });
    const packet = await new ContextEngine(db, 1, snapshot).packet("Fix parseValue bug");
    expect(packet.coverage.covered).toEqual(expect.arrayContaining(["implementation", "tests"]));
    expect(packet.coverage.missing, JSON.stringify(packet.coverage)).toEqual([]);
    expect(packet.totalEstimatedTokens).toBeLessThanOrEqual(packet.budget.maxEstimatedTokens);
    expect(packet.cachePlan.stablePrefix.role).toBe("stable_prefix");
    expect(packet.cachePlan.taskDelta.role).toBe("task_delta");
    expect(packet.cachePlan.taskDelta.itemIds).toContain("impl");
    expect(packet.cachePlan.stablePrefix.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM context_retrieval_evidence").get()).toMatchObject({ count: expect.any(Number) });
  });

  it("retains sibling implementation dependencies for security-sensitive fixes", async () => {
    const authService = add("auth-service", "AuthService", "src/auth-service.ts", "export class AuthService {}", "class");
    const validate = add("validate", "AuthService.validateToken", "src/auth-service.ts", "validateToken(token: string) { if (!token) throw new Error('missing'); return token; }", "method");
    const refresh = add("refresh", "AuthService.refreshToken", "src/auth-service.ts", "refreshToken(token: string) { return this.validateToken(token); }", "method");
    add("security", "Token trust policy", "SECURITY.md", "Refresh must not weaken token validation.", "heading");
    add("refresh-test", "rejectsEmptyRefreshTokenTest", "tests/auth-service.test.ts", "test('refresh rejects empty token', () => new AuthService().refreshToken(''));", "test");
    repository.upsertRelationship({ id: "contains-validate", sourceContextItemId: authService, targetContextItemId: validate, kind: "contains", confidence: "high", evidence: { sourcePath: "src/auth-service.ts", description: "Class contains validation method." } });
    repository.upsertRelationship({ id: "contains-refresh", sourceContextItemId: authService, targetContextItemId: refresh, kind: "contains", confidence: "high", evidence: { sourcePath: "src/auth-service.ts", description: "Class contains refresh method." } });
    const packet = await new ContextEngine(db, 1, snapshot).packet("Fix refreshToken validation error with regression test");
    const delivered = [packet.orientation, packet.exactImplementation!, packet.mandatoryContext!, packet.directlyRelatedTests!, packet.optionalContext!].flatMap((section) => section.items.map((item) => item.candidate.item.id));
    expect(delivered).toContain("refresh");
    expect(delivered).toContain("validate");
  });

  it("keeps missing required rollback incomplete", async () => {
    add("migration", "migrations/1.sql:migration", "migration", "migrations/1.sql", "CREATE TABLE users(id TEXT PRIMARY KEY);", "migration");
    const packet = await new ContextEngine(db, 1, snapshot).packet("Add schema migration with rollback");
    expect(packet.complete).toBe(false);
    expect(packet.coverage.missing).toContain("rollback");
    expect(packet.coverage.coverageEvidence).toContainEqual(expect.objectContaining({ category: "rollback", state: "required", availability: "not_found", matchingIndexedCandidateCount: 0, remainingRequirement: true }));
  });
});
