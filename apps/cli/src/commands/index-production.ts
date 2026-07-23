import { resolve } from "node:path";
import { getRepositoryRoot, isGitRepository } from "@continuum/git-analyzer";
import { initializeAndRunProductionIndex } from "@continuum/repository-indexer";
import { isInitialised } from "../config-helpers.js";
import { info, pass, printError, section } from "../display.js";

export async function runIndexCommand(
  options: { cwd: string; dir?: string },
): Promise<void> {
  const target = options.dir ? resolve(options.cwd, options.dir) : options.cwd;
  if (!(await isGitRepository(target))) {
    printError("Not a Git repository.");
    process.exitCode = 1;
    return;
  }
  const root = await getRepositoryRoot(target);
  if (!(await isInitialised(root))) {
    printError("Continuum is not initialised here. Run 'continuum init' first.");
    process.exitCode = 1;
    return;
  }
  section(`Indexing repository: ${root}`);
  const result = await initializeAndRunProductionIndex(root, { initialize: false });
  pass("Indexing complete.");
  info(`Run ID: ${result.indexRunId}`);
  info(`Snapshot: ${result.snapshotKind} (commit: ${result.baseCommitHash})`);
  info(`Compiled ${result.extractedCount} version-aware context items.`);
}
