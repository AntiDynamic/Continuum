import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Effectiveness fixtures start with a demonstrable behavioral defect. Retrieval fixtures stay unchanged. */
export async function prepareTaskBaseline(repository, taskId) {
  const edits = {
    "mono-cross-web-contract": ["packages/web/src/client.ts", source=>source.replace('return { id,', 'return { id: "unknown",')],
    "small-api-contract": ["src/api.ts", source=>source.replace('return { id };', 'return { id: "unknown" };')],
    "small-config-timeout": ["src/app-config.ts", source=>source.replace('timeoutMs: 5000', 'timeoutMs: 1')],
    "sql-migration-users": ["migrations/001_create_users.sql", source=>source.replace('email TEXT NOT NULL UNIQUE', 'email TEXT NOT NULL')],
  };
  if (edits[taskId]) { const [path,edit]=edits[taskId];await writeFile(join(repository,path),edit(await readFile(join(repository,path),"utf8"))); }
}
