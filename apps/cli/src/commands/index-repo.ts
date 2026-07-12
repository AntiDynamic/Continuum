import { getRepositoryRoot, isGitRepository } from "@continuum/git-analyzer";
import { openDatabase, migrate, IndexRunRepository, ContextRepository, RepositoryRow, RepositoryRepository } from "@continuum/database";
import { discoverFiles, resolveSnapshotIdentity, hashFile, TypeScriptExtractor, MarkdownExtractor, JsonExtractor, YamlExtractor, SqlExtractor } from "@continuum/repository-indexer";
import { getDbPath, isInitialised } from "../config-helpers.js";
import { line, section, pass, info, warn, printError } from "../display.js";
import { resolve, basename } from "node:path";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

export async function runIndexCommand(options: { cwd: string, dir?: string }) {
  const targetDir = options.dir ? resolve(options.cwd, options.dir) : options.cwd;
  
  if (!(await isGitRepository(targetDir))) {
    printError("Not a Git repository.");
    process.exit(1);
  }
  
  const repoRoot = await getRepositoryRoot(targetDir);
  
  if (!(await isInitialised(repoRoot))) {
    printError("Continuum is not initialised here. Run 'continuum init' first.");
    process.exit(1);
  }

  const db = openDatabase(getDbPath(repoRoot));
  migrate(db);

  const indexRunRepo = new IndexRunRepository(db);
  const contextRepo = new ContextRepository(db);
  const repoRepo = new RepositoryRepository(db);

  const repoRow = repoRepo.upsert(repoRoot, basename(repoRoot));

  section(`Indexing repository: ${repoRow.name}`);

  const start = performance.now();

  info("Resolving snapshot identity...");
  const snapshot = await resolveSnapshotIdentity(repoRoot);
  
  const indexRun = indexRunRepo.createRun(
    repoRow.id, 
    snapshot.snapshot_kind, 
    snapshot.base_commit_hash, 
    snapshot.worktree_hash ?? null, 
    snapshot.snapshot_kind === "worktree"
  );
  
  info(`Run ID: ${indexRun.id}`);
  info(`Snapshot: ${snapshot.snapshot_kind} (commit: ${snapshot.base_commit_hash})`);

  info("Discovering files...");
  const files = await discoverFiles(repoRoot);
  info(`Found ${files.length} files to index.`);

  const extractors = [
    { match: /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i, extractor: new TypeScriptExtractor(), lang: "typescript" },
    { match: /\.md$/i, extractor: new MarkdownExtractor(), lang: "markdown" },
    { match: /\.json$/i, extractor: new JsonExtractor(), lang: "json" },
    { match: /\.(yaml|yml)$/i, extractor: new YamlExtractor(), lang: "yaml" },
    { match: /\.sql$/i, extractor: new SqlExtractor(), lang: "sql" },
  ];

  let extractedCount = 0;

  for (const file of files) {
    const ext = extractors.find(e => e.match.test(file));
    if (!ext) continue;

    const absolutePath = resolve(repoRoot, file);
    const content = await readFile(absolutePath, "utf8");
    const fileHash = await hashFile(absolutePath);

    const symbols = ext.extractor.extract(absolutePath, content);
    
    for (const sym of symbols) {
      const item = contextRepo.upsertContextItem(repoRow.id, sym.kind, `${file}:${sym.name}`);
      
      contextRepo.insertContextItemVersion({
        id: crypto.randomUUID(),
        context_item_id: item.id,
        content: sym.content,
        title: sym.name,
        source_path: file,
        source_start_line: sym.startLine,
        source_end_line: sym.endLine,
        symbol_name: sym.name,
        language: ext.lang,
        content_hash: fileHash,
        source_blob_hash: fileHash, // simplification for now
        valid_from_commit: snapshot.base_commit_hash,
        valid_to_commit_exclusive: null,
        indexed_at: new Date().toISOString(),
        provenance_json: null,
        staleness_status: "current",
        staleness_reason: null,
        metadata_json: null
      });
      extractedCount++;
    }
  }

  const durationMs = performance.now() - start;
  indexRunRepo.finishRun(indexRun.id, "success", durationMs);
  
  pass(`Indexing complete in ${Math.round(durationMs)}ms.`);
  info(`Extracted ${extractedCount} context item versions.`);
}
