import { getRepositoryRoot, isGitRepository } from "@continuum/git-analyzer";
import { ContextRepository, IndexRunRepository, type Db, RepositoryRepository } from "@continuum/database";
import {
  CoherentMarkdownExtractor, DeterministicContextCompiler,
  discoverFiles, hashFile, inferContextRelationships, JsonConfigurationExtractor, resolveSnapshotIdentity,
  StatementSqlExtractor, TypeScriptCompilerApiExtractor, YamlConfigurationExtractor,
} from "./index.js";
import type { CompiledContextItem, ExtractedContextCandidate } from "@continuum/shared";
import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { snapshotsEqual } from "@continuum/shared";
async function packageNameFor(root: string, source: string): Promise<string> {
  let directory = resolve(root, source, "..");
  while (directory.startsWith(root)) {
    try { const pkg = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8")); if (typeof pkg.name === "string") return pkg.name; } catch { /* no package here */ }
    if (directory === root) break;
    directory = resolve(directory, "..");
  }
  return basename(root);
}

export async function indexRepository(db: Db, repoRoot: string) {
  db.exec("SAVEPOINT repository_index");
  try {
  const indexRuns = new IndexRunRepository(db);
  const contexts = new ContextRepository(db);
  const repositories = new RepositoryRepository(db);
  const repository = repositories.upsert(repoRoot, basename(repoRoot));
  const started = performance.now();
  const snapshot = await resolveSnapshotIdentity(repoRoot);
  const run = indexRuns.createRun(repository.id, snapshot.snapshot_kind, snapshot.base_commit_hash, snapshot.worktree_hash, snapshot.dirty);

  const extractors = [
    { match: /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i, extractor: new TypeScriptCompilerApiExtractor(), language: "typescript" },
    { match: /\.md$/i, extractor: new CoherentMarkdownExtractor(), language: "markdown" },
    { match: /\.json$/i, extractor: new JsonConfigurationExtractor(), language: "json" },
    { match: /\.(yaml|yml)$/i, extractor: new YamlConfigurationExtractor(), language: "yaml" },
    { match: /\.sql$/i, extractor: new StatementSqlExtractor(), language: "sql" },
  ];
  const files = await discoverFiles(repoRoot);
  const scanned: { file: string; content: string; fileHash: string; language: string; candidates: ExtractedContextCandidate[] }[] = [];
  for (const file of files) {
    const selected = extractors.find((entry) => entry.match.test(file));
    if (!selected) continue;
    const absolute = resolve(repoRoot, file);
    const content = await readFile(absolute, "utf8");
    const fileHash = await hashFile(absolute);
    const candidates = await selected.extractor.extract(absolute, content) as ExtractedContextCandidate[];
    scanned.push({ file, content, fileHash, language: selected.language, candidates });
  }

  const compiler = new DeterministicContextCompiler();
  const persisted: { compiled: CompiledContextItem; itemId: string; contextItemId: string }[] = [];
  for (const source of scanned) {
    const compiledItems = await compiler.compile({
      repositoryId: repository.id,
      repositoryRoot: repoRoot,
      sourcePath: source.file,
      language: source.language,
      sourceContent: source.content,
      snapshot,
      extractedCandidates: source.candidates,
      repositoryMetadata: { name: repository.name, packageName: await packageNameFor(repoRoot, source.file) },
    });
    for (const compiled of compiledItems) {
      const item = contexts.upsertContextItem(repository.id, compiled.kind, compiled.logicalKey);
      const versionId = crypto.randomUUID();
      contexts.insertContextItemVersion({
        id: versionId,
        context_item_id: item.id,
        content: compiled.content,
        contextual_header: compiled.contextualHeader,
        compiled_content: compiled.compiledContent,
        title: compiled.title,
        source_path: compiled.sourcePath,
        source_start_line: compiled.sourceStartLine,
        source_end_line: compiled.sourceEndLine,
        symbol_name: compiled.symbolName ?? null,
        language: compiled.language,
        content_hash: compiled.contentHash,
        source_blob_hash: compiled.sourceBlobHash ?? source.fileHash,
        valid_from_commit: snapshot.base_commit_hash,
        valid_to_commit_exclusive: null,
        indexed_at: new Date().toISOString(),
        provenance_json: JSON.stringify(compiled.provenance),
        staleness_status: snapshot.dirty ? "uncommitted" : "current",
        staleness_reason: snapshot.dirty ? "Compiled from an uncommitted worktree snapshot." : null,
        metadata_json: JSON.stringify(compiled.metadata),
      });
      const actualId = contexts.findLatestItemVersion(item.id)!.id;
      persisted.push({ compiled, itemId: actualId, contextItemId: item.id });
      db.prepare("INSERT INTO context_snapshot_versions(index_run_id,context_item_version_id) VALUES(?,?)").run(run.id, actualId);
    }
  }
  contexts.retireMissingCurrentVersions(repository.id, [...new Set(persisted.map((entry) => entry.contextItemId))], snapshot.base_commit_hash);

  db.prepare("DELETE FROM context_item_links WHERE source_item_id IN (SELECT id FROM context_items WHERE repository_id=?) OR target_item_id IN (SELECT id FROM context_items WHERE repository_id=?)").run(repository.id,repository.id);
  for (const relationship of inferContextRelationships(persisted,repoRoot)) contexts.upsertRelationship(relationship);

  const after = await resolveSnapshotIdentity(repoRoot);
  if (!snapshotsEqual(snapshot, after)) throw new Error("Repository changed during indexing; retry indexing.");
  const duration = performance.now() - started;
  indexRuns.finishRun(run.id, "success", duration);
  db.exec("RELEASE SAVEPOINT repository_index");
  return { repositoryId: repository.id, indexRunId: run.id, snapshot, itemCount: persisted.length, durationMs: duration };
  } catch(error) { db.exec("ROLLBACK TO SAVEPOINT repository_index; RELEASE SAVEPOINT repository_index"); throw error; }
}
