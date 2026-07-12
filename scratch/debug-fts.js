import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { migrate } from "../packages/database/dist/connection.js";

const db = new DatabaseSync(":memory:");
migrate(db);

db.exec(`INSERT INTO repositories (id, canonical_path, name, created_at, updated_at) VALUES (1, '/test', 'test', 'now', 'now')`);

db.exec(`INSERT INTO context_items (id, repository_id, kind, logical_key, created_at) VALUES ('c1', 1, 'function', 'test', 'now')`);

const res1 = db.prepare(`INSERT INTO context_item_versions (
  id, context_item_id, content, source_path, source_start_line, source_end_line, language, content_hash, source_blob_hash, valid_from_commit, indexed_at, staleness_status
) VALUES (
  'v1', 'c1', 'function searchMe() {}', 'test.ts', 1, 3, 'ts', 'hash', 'bhash', 'commit', 'now', 'fresh'
)`).run();

console.log("Inserted rowid:", res1.lastInsertRowid);

db.prepare(`INSERT INTO context_items_fts (rowid, content, title, symbol_name) VALUES (?, ?, ?, ?)`).run(Number(res1.lastInsertRowid), 'function searchMe() {}', null, null);

const all = db.prepare("SELECT * FROM context_items_fts").all();
console.log("FTS Table contents:", all);

const match = db.prepare("SELECT rowid, * FROM context_items_fts WHERE context_items_fts MATCH 'searchMe'").all();
console.log("MATCH searchMe:", match);
