import { getRepositoryRoot, isGitRepository } from "@continuum/git-analyzer";
import { openDatabase, ContextRepository, RepositoryRow, RepositoryRepository } from "@continuum/database";
import { packContext, rankResults } from "@continuum/shared";
import { getDbPath, isInitialised } from "../config-helpers.js";
import { line, section, info, printError } from "../display.js";
import { resolve, basename } from "node:path";

export async function runContextCommand(query: string, options: { cwd: string, repo?: string }) {
  const targetDir = options.repo ? resolve(options.cwd, options.repo) : options.cwd;
  
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
  const contextRepo = new ContextRepository(db);
  const repoRepo = new RepositoryRepository(db);

  const repoRow = repoRepo.upsert(repoRoot, basename(repoRoot));

  section(`Retrieving context for query: "${query}"`);

  // Search items using FTS5 + lexical fallback
  const rawResults = contextRepo.searchContextItems(query, 50, repoRow.id);
  info(`Found ${rawResults.length} raw matches.`);

  // Rank and score results
  const ranked = rankResults(query, rawResults);

  // Pack them into a token budget
  const packet = packContext(ranked);
  
  info(`Packed ${packet.totalItems} items (${packet.totalCharacters} chars). Overflow: ${packet.overflowItems}`);

  line();
  for (const item of packet.items) {
    info(`[Rank ${item.rank} | Score ${item.finalScore.toFixed(2)}] ${item.version.source_path}:${item.version.symbol_name}`);
    console.log(item.version.content.substring(0, 200) + (item.version.content.length > 200 ? "..." : ""));
    line();
  }
}
