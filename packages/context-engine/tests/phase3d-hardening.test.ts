import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";
import { ContextRepository, migrate, openDatabase, type Db } from "@continuum/database";
import type { TokenEstimator } from "@continuum/shared";
import { ContextEngine, DEFAULT_PACKET_BUDGET } from "../src/engine.js";
import { normalizeRetrievalTerms, RETRIEVAL_NORMALIZATION_VERSION } from "../src/normalization.js";

describe("Phase 3D deterministic hardening", () => {
  let db: Db;
  let repository: ContextRepository;
  const path = join(tmpdir(), `continuum-phase3d-${process.pid}-${Date.now()}.db`);
  const snapshot = { snapshot_kind: "commit" as const, base_commit_hash: "phase3d", worktree_hash: null, dirty: false };

  beforeEach(() => {
    db = openDatabase(path);
    migrate(db);
    db.prepare("INSERT INTO repositories(id, canonical_path, name, created_at, updated_at) VALUES(1, '/phase3d', 'phase3d', ?, ?)").run(new Date().toISOString(), new Date().toISOString());
    repository = new ContextRepository(db);
  });
  afterEach(() => { db.close(); try { unlinkSync(path); } catch { /* Windows may briefly retain SQLite. */ } });

  function add(id: string, symbol: string | null, sourcePath: string, content: string, kind = "function", extraMetadata: Record<string, unknown> = {}): string {
    const item = repository.upsertContextItem(1, kind, `${sourcePath}:${symbol ?? "file"}`);
    repository.insertContextItemVersion({ id, context_item_id: item.id, content, contextual_header: `File: ${sourcePath}\nSymbol: ${symbol ?? "(file)"}`, compiled_content: content, title: symbol ?? sourcePath, source_path: sourcePath, source_start_line: 1, source_end_line: 5, symbol_name: symbol, language: kind === "heading" ? "markdown" : "typescript", content_hash: id + "-hash", source_blob_hash: id + "-blob", valid_from_commit: "phase3d", valid_to_commit_exclusive: null, indexed_at: new Date().toISOString(), provenance_json: JSON.stringify({ repositoryId: 1, sourcePath, sourceStartLine: 1, sourceEndLine: 5, extractor: "fixture", snapshot, confidence: "high" }), staleness_status: "current", staleness_reason: null, metadata_json: JSON.stringify({ declarationKind: kind, ...extraMetadata }) });
    return item.id;
  }

  it("normalizes joined and separated identifier variants deterministically", () => {
    expect(RETRIEVAL_NORMALIZATION_VERSION).toBe("deterministic-identifier-normalization-v1");
    expect(normalizeRetrievalTerms("time out")).toContain("timeout");
    expect(normalizeRetrievalTerms("sessionTimeoutMs")).toEqual(expect.arrayContaining(["session", "timeout", "sessiontimeout"]));
    expect(normalizeRetrievalTerms("refresh_token_hash")).toEqual(expect.arrayContaining(["refresh", "token", "refreshtoken"]));
    expect(normalizeRetrievalTerms("UserResponse")).toEqual(expect.arrayContaining(["user", "response", "userresponse"]));
    expect(normalizeRetrievalTerms("rollbackMigration")).toEqual(expect.arrayContaining(["rollback", "migration", "rollbackmigration"]));
  });

  it("protects exact context and drops optional content before the hard ceiling", async () => {
    add("exact", "sessionTimeoutMs", "src/config.ts", "export const sessionTimeoutMs = 1000;");
    for (let index = 0; index < 20; index += 1) add("optional-" + index, "optionalSession" + index, "src/optional-" + index + ".ts", "export function optionalSession" + index + "() { return '" + "x".repeat(600) + "'; }");
    const packet = await new ContextEngine(db, 1, snapshot).packet("Fix session timeout");
    expect(packet.totalEstimatedTokens).toBeLessThanOrEqual(1900);
    expect(packet.budget).toMatchObject({ maxEstimatedTokens: 1900, optionalContextCeiling: 250, mandatoryContextReserve: 350 });
    expect(packet.exactImplementation?.items.some((item) => item.candidate.item.id === "exact")).toBe(true);
    expect(packet.optionalContext!.estimatedTokens).toBeLessThanOrEqual(250);
    expect(packet.escalationCandidates.estimatedTokens).toBe(0);
    expect(packet.escalationCandidates.items.every((item) => item.content === "")).toBe(true);
  });

  it("marks an oversized mandatory symbol incomplete without exceeding the ceiling", async () => {
    add("oversized", "rollbackMigration", "migrations/rollback.ts", "export function rollbackMigration() {" + "x".repeat(9000) + "}");
    const packet = await new ContextEngine(db, 1, snapshot).packet("migration rollback using rollbackMigration", { ...DEFAULT_PACKET_BUDGET, maxEstimatedTokensPerItem: 400 });
    expect(packet.totalEstimatedTokens).toBeLessThanOrEqual(1900);
    expect(packet.omittedItems).toContainEqual(expect.objectContaining({ contextItemVersionId: "oversized", reason: "oversized" }));
    expect(packet.complete).toBe(false);
    expect(packet.coverage.additionalEstimatedBudgetRequired).toBeGreaterThan(0);
  });

  it("retains AuthService.refreshToken without redundantly delivering its containing file", async () => {
    add("refresh-symbol", "AuthService.refreshToken", "src/auth-service.ts", "refreshToken(input: Token): Token { return rotate(input); }");
    add("auth-file", null, "src/auth-service.ts", "export class AuthService { refreshToken(input: Token): Token { return rotate(input); } }", "file");
    const packet = await new ContextEngine(db, 1, snapshot).packet("Fix AuthService.refreshToken in src/auth-service.ts");
    const delivered = [packet.orientation, packet.exactImplementation!, packet.mandatoryContext!, packet.directlyRelatedTests!, packet.optionalContext!].flatMap((section) => section.items);
    expect(delivered.some((item) => item.candidate.item.id === "refresh-symbol")).toBe(true);
    expect(delivered.some((item) => item.candidate.item.id === "auth-file")).toBe(false);
    expect(packet.omittedItems).toContainEqual(expect.objectContaining({ contextItemVersionId: "auth-file", reason: "diversity" }));
  });

  it("discovers applicable security and configuration tests without making absent tests mandatory", async () => {
    add("auth", "validateToken", "src/auth-service.ts", "export function validateToken(token: string) { return token.length > 0; }");
    add("security", "Token trust policy", "SECURITY.md", "Authentication tokens must be validated without weakening trust.", "heading", { constraintKind: "security" });
    add("auth-test", "validateTokenTest", "tests/auth-service.test.ts", "test('authentication token validation', () => validateToken('safe'));", "function");
    const securityPacket = await new ContextEngine(db, 1, snapshot).packet("Fix authentication token validation without weakening security");
    expect(securityPacket.directlyRelatedTests?.items.some((item) => item.candidate.item.id === "auth-test")).toBe(true);
    expect(securityPacket.coverage.coverageEvidence.find((item) => item.category === "tests")?.state).toBe("recommended");

    const isolatedPath = join(tmpdir(), `continuum-phase3d-config-${process.pid}-${Date.now()}.db`);
    const isolated = openDatabase(isolatedPath);
    try {
      migrate(isolated);
      isolated.prepare("INSERT INTO repositories(id, canonical_path, name, created_at, updated_at) VALUES(1, '/config-only', 'config-only', ?, ?)").run(new Date().toISOString(), new Date().toISOString());
      const isolatedRepository = new ContextRepository(isolated);
      const item = isolatedRepository.upsertContextItem(1, "constant", "config/app.yaml:timeoutMs");
      isolatedRepository.insertContextItemVersion({ id: "config", context_item_id: item.id, content: "timeoutMs: 1000", contextual_header: "File: config/app.yaml", compiled_content: "timeoutMs: 1000", title: "timeoutMs", source_path: "config/app.yaml", source_start_line: 1, source_end_line: 1, symbol_name: "timeoutMs", language: "yaml", content_hash: "config-hash", source_blob_hash: "config-blob", valid_from_commit: "phase3d", valid_to_commit_exclusive: null, indexed_at: new Date().toISOString(), provenance_json: JSON.stringify({ repositoryId: 1, sourcePath: "config/app.yaml", sourceStartLine: 1, sourceEndLine: 1, extractor: "fixture", snapshot, confidence: "high" }), staleness_status: "current", staleness_reason: null, metadata_json: JSON.stringify({ declarationKind: "constant" }) });
      const configPacket = await new ContextEngine(isolated, 1, snapshot).packet("Fix configuration timeoutMs in config/app.yaml");
      expect(configPacket.coverage.coverageEvidence.find((entry) => entry.category === "tests")?.state).toBe("unavailable");
      expect(configPacket.coverage.complete).toBe(true);
    } finally { isolated.close(); try { unlinkSync(isolatedPath); } catch { /* Windows may briefly retain SQLite. */ } }
  });

  it("is deterministic with a large optional pool and bounded relationship-style fan-out", async () => {
    add("target", "UserResponse", "src/contracts.ts", "export interface UserResponse { id: string }", "interface");
    for (let index = 0; index < 80; index += 1) add(`fanout-${index}`, `UserResponseConsumer${index}`, `src/consumer-${index}.ts`, `export function useUserResponse${index}(value: UserResponse) { return value.id; }`);
    const engine = new ContextEngine(db, 1, snapshot);
    const first = await engine.packet("Change UserResponse");
    const second = await engine.packet("Change UserResponse");
    const ids = (packet: typeof first) => [packet.orientation, packet.exactImplementation!, packet.mandatoryContext!, packet.directlyRelatedTests!, packet.optionalContext!].flatMap((section) => section.items.map((item) => item.candidate.item.id));
    expect(ids(second)).toEqual(ids(first));
    expect(first.totalEstimatedTokens).toBeLessThanOrEqual(1900);
    expect(first.optionalContext!.estimatedTokens).toBeLessThanOrEqual(250);
  });

  it("estimates each hydrated candidate once per search", async () => {
    add("one", "UserResponse", "src/contracts.ts", "export interface UserResponse { id: string }", "interface");
    add("two", "fetchUser", "src/client.ts", "export function fetchUser(): UserResponse { throw new Error(); }");
    let calls = 0;
    const estimator: TokenEstimator = { id: "counting", estimate: (value) => { calls += 1; return Math.ceil(value.length / 4); } };
    const results = await new ContextEngine(db, 1, snapshot, estimator).search("change user response");
    expect(calls).toBe(results.length);
  });
});
