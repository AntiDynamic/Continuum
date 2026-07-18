import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ContextRepository, migrate, openDatabase, type Db } from "@continuum/database";
import { ContextEngine } from "../src/engine.js";

interface Fixture { task: string; requiredContext: string[]; irrelevantContext: string[] }
const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixtures = readdirSync(root).filter((file) => file.endsWith(".json")).sort().map((file) => JSON.parse(readFileSync(join(root, file), "utf8")) as Fixture);

function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function shape(label: string): { path: string; kind: string; language: string; metadata: Record<string, unknown> } {
  const lower = label.toLowerCase();
  if (lower.includes("test")) return { path: `tests/${slug(label)}.test.ts`, kind: "test", language: "typescript", metadata: { declarationKind: "test" } };
  if (lower.includes("security constraint")) return { path: "SECURITY.md", kind: "constraint", language: "markdown", metadata: { constraintKind: "security", authoritySource: "SECURITY.md" } };
  if (lower.includes("documentation")) return { path: `docs/${slug(label)}.md`, kind: "heading", language: "markdown", metadata: { declarationKind: "heading" } };
  if (/schema|migration|rollback/.test(lower)) return { path: `migrations/${slug(label)}.sql`, kind: "migration", language: "sql", metadata: { declarationKind: "migration" } };
  if (/store|repository|engine/.test(lower)) return { path: `src/${slug(label)}.ts`, kind: "interface", language: "typescript", metadata: { declarationKind: "interface" } };
  return { path: `src/${slug(label)}.ts`, kind: "function", language: "typescript", metadata: { declarationKind: "function" } };
}

describe("deterministic retrieval benchmarks", () => {
  const dbFiles: string[] = [];
  afterEach(() => { for (const file of dbFiles.splice(0)) try { unlinkSync(file); } catch { /* Windows cleanup may lag. */ } });

  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    it(`retrieves required context without fixture distractors: ${fixture.task}`, async () => {
      const dbPath = join(tmpdir(), `continuum-benchmark-${process.pid}-${fixtureIndex}-${Date.now()}.db`);
      dbFiles.push(dbPath);
      const db: Db = openDatabase(dbPath);
      migrate(db);
      db.prepare("INSERT INTO repositories(id, canonical_path, name, created_at, updated_at) VALUES(1, '/benchmark', 'benchmark', ?, ?)").run(new Date().toISOString(), new Date().toISOString());
      const repository = new ContextRepository(db);
      const ids = new Map<string, string>();
      for (const [relevant, labels] of [[true, fixture.requiredContext], [false, fixture.irrelevantContext]] as const) {
        for (const label of labels) {
          const shaped = shape(label);
          const item = repository.upsertContextItem(1, shaped.kind, label);
          const id = crypto.randomUUID();
          ids.set(label, id);
          const source = relevant ? `${fixture.task}. ${label}. ${label.toLowerCase().includes("rollback") ? "ROLLBACK;" : ""}` : label;
          repository.insertContextItemVersion({ id, context_item_id: item.id, content: source, contextual_header: `Repository: benchmark\nFile: ${shaped.path}\nSymbol: ${label}`, compiled_content: `Repository: benchmark\n\n${source}`, title: label, source_path: shaped.path, source_start_line: 1, source_end_line: 2, symbol_name: label, language: shaped.language, content_hash: `${id}-hash`, source_blob_hash: `${id}-blob`, valid_from_commit: "fixture", valid_to_commit_exclusive: null, indexed_at: new Date().toISOString(), provenance_json: null, staleness_status: "current", staleness_reason: null, metadata_json: JSON.stringify(shaped.metadata) });
        }
      }
      const engine = new ContextEngine(db, 1, { snapshot_kind: "commit", base_commit_hash: "fixture", worktree_hash: null, dirty: false });
      const packet = await engine.packet(fixture.task);
      const selected = new Set([...packet.orientation.items, ...packet.implementation.items].map((item) => item.candidate.item.id));
      const recall = fixture.requiredContext.filter((label) => selected.has(ids.get(label) ?? "")).length / fixture.requiredContext.length;
      const irrelevantSelected = fixture.irrelevantContext.filter((label) => selected.has(ids.get(label) ?? "")).length;
      const precision = selected.size ? (selected.size - irrelevantSelected) / selected.size : 0;
      expect(recall).toBe(1);
      expect(precision).toBe(1);
      expect(packet.totalEstimatedTokens).toBeLessThanOrEqual(packet.budget.maxEstimatedTokens);
      expect(packet.coverage.complete).toBe(true);
      db.close();
    });
  }
});
