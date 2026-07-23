import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  ContextRepository,
  IndexRunRepository,
  RepositoryRepository,
  migrate,
  openDatabase,
} from "@continuum/database";
import { getRepositoryRoot, isGitRepository } from "@continuum/git-analyzer";
import { DEFAULT_CONFIG, type CompiledContextItem, type ExtractedContextCandidate } from "@continuum/shared";
import { DeterministicContextCompiler } from "./compiler.js";
import { discoverFiles } from "./discovery.js";
import {
  CoherentMarkdownExtractor,
  JsonConfigurationExtractor,
  StatementSqlExtractor,
  TypeScriptCompilerApiExtractor,
  YamlConfigurationExtractor,
} from "./extractors/index.js";
import { hashFile } from "./hashing.js";
import { inferContextRelationships } from "./relationships.js";
import { resolveSnapshotIdentity } from "./snapshot.js";

export const INDEX_STRATEGY_VERSION = "continuum.production-index.v2";

export interface ProductionIndexResult {
  repositoryRoot: string;
  databasePath: string;
  repositoryId: number;
  indexRunId: string;
  baseCommitHash: string;
  worktreeHash: string | null;
  snapshotKind: string;
  extractedCount: number;
}

const packageNameFor = (path: string): string => {
  const match = path.replaceAll("\\", "/").match(/^(packages|apps)\/([^/]+)/);
  return match?.[2] ? `@continuum/${match[2]}` : "continuum";
};

export async function initializeAndRunProductionIndex(
  directory: string,
  options: { initialize?: boolean; repositoryId?: number } = {},
): Promise<ProductionIndexResult> {
  if (!(await isGitRepository(directory))) throw new Error("Not a Git repository.");
  const repositoryRoot = await getRepositoryRoot(directory);
  const continuumDirectory = join(repositoryRoot, ".continuum");
  const databasePath = join(continuumDirectory, "continuum.db");
  if (options.initialize !== false) {
    await mkdir(join(continuumDirectory, "runs"), { recursive: true });
    await writeFile(
      join(continuumDirectory, "config.json"),
      JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
      "utf8",
    );
  }
  const db = openDatabase(databasePath);
  try {
    migrate(db);
    const repositories = new RepositoryRepository(db);
    if (options.repositoryId !== undefined) {
      const timestamp = new Date().toISOString();
      db.prepare(
        "INSERT INTO repositories(id,canonical_path,name,created_at,updated_at) VALUES(?,?,?,?,?)",
      ).run(options.repositoryId, repositoryRoot, basename(repositoryRoot), timestamp, timestamp);
    }
    const repository = repositories.upsert(repositoryRoot, basename(repositoryRoot));
    const contexts = new ContextRepository(db);
    const indexRuns = new IndexRunRepository(db);
    const started = performance.now();
    const snapshot = await resolveSnapshotIdentity(repositoryRoot);
    const run = indexRuns.createRun(
      repository.id,
      snapshot.snapshot_kind,
      snapshot.base_commit_hash,
      snapshot.worktree_hash,
      snapshot.dirty,
    );
    const extractors = [
      { match: /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i, extractor: new TypeScriptCompilerApiExtractor(), language: "typescript" },
      { match: /\.md$/i, extractor: new CoherentMarkdownExtractor(), language: "markdown" },
      { match: /\.json$/i, extractor: new JsonConfigurationExtractor(), language: "json" },
      { match: /\.(yaml|yml)$/i, extractor: new YamlConfigurationExtractor(), language: "yaml" },
      { match: /\.sql$/i, extractor: new StatementSqlExtractor(), language: "sql" },
    ];
    const scanned: Array<{
      file: string;
      content: string;
      fileHash: string;
      language: string;
      candidates: ExtractedContextCandidate[];
    }> = [];
    for (const file of await discoverFiles(repositoryRoot)) {
      const selected = extractors.find((entry) => entry.match.test(file));
      if (!selected) continue;
      const absolute = resolve(repositoryRoot, file);
      const content = await readFile(absolute, "utf8");
      scanned.push({
        file,
        content,
        fileHash: await hashFile(absolute),
        language: selected.language,
        candidates: await selected.extractor.extract(absolute, content) as ExtractedContextCandidate[],
      });
    }
    const compiler = new DeterministicContextCompiler();
    const persisted: Array<{ compiled: CompiledContextItem; itemId: string; contextItemId: string }> = [];
    for (const source of scanned) {
      const compiledItems = await compiler.compile({
        repositoryId: repository.id,
        repositoryRoot,
        sourcePath: source.file,
        language: source.language,
        sourceContent: source.content,
        snapshot,
        extractedCandidates: source.candidates,
        repositoryMetadata: {
          name: repository.name,
          packageName: packageNameFor(source.file),
        },
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
    contexts.retireMissingCurrentVersions(
      repository.id,
      [...new Set(persisted.map((entry) => entry.contextItemId))],
      snapshot.base_commit_hash,
    );
    for (const relationship of inferContextRelationships(persisted)) {
      contexts.upsertRelationship(relationship);
    }
    indexRuns.finishRun(run.id, "success", performance.now() - started);
    return {
      repositoryRoot,
      databasePath,
      repositoryId: repository.id,
      indexRunId: run.id,
      baseCommitHash: snapshot.base_commit_hash,
      worktreeHash: snapshot.worktree_hash,
      snapshotKind: snapshot.snapshot_kind,
      extractedCount: persisted.length,
    };
  } finally {
    db.close();
  }
}
