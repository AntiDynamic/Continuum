import { getRepositoryRoot, isGitRepository } from "@continuum/git-analyzer";
import { ContextRepository, IndexRunRepository, openDatabase, migrate, RepositoryRepository } from "@continuum/database";
import {
  CoherentMarkdownExtractor, DeterministicContextCompiler,
  discoverFiles, hashFile, inferContextRelationships, JsonConfigurationExtractor, resolveSnapshotIdentity,
  StatementSqlExtractor, TypeScriptCompilerApiExtractor, YamlConfigurationExtractor,
} from "@continuum/repository-indexer";
import type { CompiledContextItem, ExtractedContextCandidate } from "@continuum/shared";
import { getDbPath, isInitialised } from "../config-helpers.js";
import { info, pass, printError, section } from "../display.js";
import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

function packageNameFor(path: string): string {
  const match = path.replaceAll("\\", "/").match(/^(packages|apps)\/([^/]+)/);
  return match?.[2] ? `@continuum/${match[2]}` : "continuum";
}

export async function runIndexCommand(options: { cwd: string; dir?: string }): Promise<void> {
  const targetDir = options.dir ? resolve(options.cwd, options.dir) : options.cwd;
  if (!(await isGitRepository(targetDir))) { printError("Not a Git repository."); process.exitCode = 1; return; }
  const repoRoot = await getRepositoryRoot(targetDir);
  if (!(await isInitialised(repoRoot))) { printError("Continuum is not initialised here. Run 'continuum init' first."); process.exitCode = 1; return; }

  const db = openDatabase(getDbPath(repoRoot));
  migrate(db);
  const indexRuns = new IndexRunRepository(db);
  const contexts = new ContextRepository(db);
  const repositories = new RepositoryRepository(db);
  const repository = repositories.upsert(repoRoot, basename(repoRoot));
  section(`Indexing repository: ${repository.name}`);
  const started = performance.now();
  const snapshot = await resolveSnapshotIdentity(repoRoot);
  const run = indexRuns.createRun(repository.id, snapshot.snapshot_kind, snapshot.base_commit_hash, snapshot.worktree_hash, snapshot.dirty);
  info(`Run ID: ${run.id}`);
  info(`Snapshot: ${snapshot.snapshot_kind} (commit: ${snapshot.base_commit_hash})`);

  const extractors = [
    { match: /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i, extractor: new TypeScriptCompilerApiExtractor(), language: "typescript" },
    { match: /\.md$/i, extractor: new CoherentMarkdownExtractor(), language: "markdown" },
    { match: /\.json$/i, extractor: new JsonConfigurationExtractor(), language: "json" },
    { match: /\.(yaml|yml)$/i, extractor: new YamlConfigurationExtractor(), language: "yaml" },
    { match: /\.sql$/i, extractor: new StatementSqlExtractor(), language: "sql" },
  ];
  const files = await discoverFiles(repoRoot);
  info(`Found ${files.length} files to index.`);
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
      repositoryMetadata: { name: repository.name, packageName: packageNameFor(source.file) },
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
      persisted.push({ compiled, itemId: versionId, contextItemId: item.id });
    }
  }
  contexts.retireMissingCurrentVersions(repository.id, [...new Set(persisted.map((entry) => entry.contextItemId))], snapshot.base_commit_hash);

  for (const relationship of inferContextRelationships(persisted)) contexts.upsertRelationship(relationship);

  const duration = performance.now() - started;
  indexRuns.finishRun(run.id, "success", duration);
  db.close();
  pass(`Indexing complete in ${Math.round(duration)}ms.`);
  info(`Compiled ${persisted.length} version-aware context items.`);
}
