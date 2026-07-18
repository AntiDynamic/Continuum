import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, Db, migrate } from "../src/connection.js";
import { ContextRepository } from "../src/repositories/context-repository.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";

describe("ContextRepository", () => {
  let db: Db;
  let repo: ContextRepository;
  const dbPath = join(tmpdir(), `continuum-test-context-${Date.now()}.db`);

  beforeEach(() => {
    db = openDatabase(dbPath);
    migrate(db);
    repo = new ContextRepository(db);

    // Create a mock repository
    db.prepare("INSERT INTO repositories (id, canonical_path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(1, "/test", "test", new Date().toISOString(), new Date().toISOString());
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it("upserts and retrieves context items", () => {
    const item1 = repo.upsertContextItem(1, "function", "myFunc");
    expect(item1.id).toBeDefined();
    expect(item1.logical_key).toBe("myFunc");

    const item2 = repo.upsertContextItem(1, "function", "myFunc");
    expect(item2.id).toBe(item1.id); // Should return existing
  });

  it("inserts versions and searches them", () => {
    const item = repo.upsertContextItem(1, "function", "searchMe");
    
    const firstVersion = {
      id: "v1",
      context_item_id: item.id,
      content: "function searchMe() { return 'hello'; }",
      source_path: "test.ts",
      source_start_line: 1,
      source_end_line: 3,
      language: "typescript",
      content_hash: "hash",
      source_blob_hash: "blobhash",
      valid_from_commit: "commit1",
      indexed_at: new Date().toISOString(),
      staleness_status: "fresh"
    } as const;
    repo.insertContextItemVersion(firstVersion);

    const latest = repo.findLatestItemVersion(item.id);

    repo.insertContextItemVersion({
      ...firstVersion,
      id: "v-duplicate",
      valid_from_commit: "commit2",
    });
    const duplicateCount = db
      .prepare(
        "SELECT COUNT(*) AS count FROM context_item_versions WHERE context_item_id = ?",
      )
      .get(item.id) as { count: number };
    expect(duplicateCount.count).toBe(1);

    repo.insertContextItemVersion({
      ...firstVersion,
      id: "v2",
      content: "function searchMe() { return 'updated'; }",
      content_hash: "hash2",
      source_blob_hash: "blobhash2",
      valid_from_commit: "commit2",
    });
    const versions = db
      .prepare(
        "SELECT id, valid_to_commit_exclusive FROM context_item_versions WHERE context_item_id = ? ORDER BY rowid",
      )
      .all(item.id) as { id: string; valid_to_commit_exclusive: string | null }[];
    expect(versions).toEqual([
      { id: "v1", valid_to_commit_exclusive: "commit2" },
      { id: "v2", valid_to_commit_exclusive: null },
    ]);
    expect(latest?.id).toBe("v1");
    const current = repo.findLatestItemVersion(item.id);
    expect(current?.id).toBe("v2");

    const results = repo.searchContextItems("searchMe", 10, 1);
    expect(results.length).toBe(1);
    expect(results[0].version.id).toBe("v2");
    db.exec("DROP TABLE context_items_fts_v2");
    const fallback = repo.searchContextItems("updated searchMe", 10, 1);
    expect(fallback[0]).toMatchObject({
      version: { id: "v2" },
      backend: "fallback_lexical",
    });
    expect(fallback[0]?.score).toBeGreaterThan(0);
  });
});
