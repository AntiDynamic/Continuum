import { getRepositoryRoot } from "@continuum/git-analyzer";
import { openDatabase, migrate } from "@continuum/database";
import { indexRepository } from "@continuum/repository-indexer";
import { resolve } from "node:path";
import { getDbPath, isInitialised } from "../config-helpers.js";
import { info, pass } from "../display.js";
export async function runIndexCommand(options: {cwd:string;dir?:string}): Promise<void> {
  const root = await getRepositoryRoot(resolve(options.cwd, options.dir ?? "."));
  if (!await isInitialised(root)) throw new Error("Continuum is not initialised. Run continuum init first.");
  const db = openDatabase(getDbPath(root));
  try { migrate(db); const result = await indexRepository(db, root); pass(`Indexing complete in ${Math.round(result.durationMs)}ms.`); info(`Compiled ${result.itemCount} version-aware context items.`); }
  finally { db.close(); }
}
