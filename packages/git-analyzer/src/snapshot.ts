import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { execa } from "execa";
import type { IndexSnapshotIdentity } from "@continuum/shared";
import { getCurrentCommit, getRepositoryRoot } from "./git.js";

export interface CanonicalWorktreeEntry {
  path: string;
  originalPath?: string;
  recordType: "ordinary" | "rename_or_copy" | "unmerged" | "untracked";
  indexState: string;
  worktreeState: string;
  headMode?: string;
  indexMode?: string;
  worktreeMode?: string;
  headObjectId?: string;
  indexObjectId?: string;
  worktreeContentHash?: string;
  deletionMarker?: boolean;
  symlinkTargetHash?: string;
}

function normalisePath(path: string): string {
  const value = path.normalize("NFC").replaceAll("\\", "/");
  if (!value || isAbsolute(value) || value.split("/").includes("..")) throw new Error(`Invalid repository-relative path: ${path}`);
  return value;
}
function isContinuumStatePath(path: string): boolean {
  return path === ".continuum" || path.startsWith(".continuum/");
}

async function gitOutput(root: string, args: string[]): Promise<string> {
  return (await execa("git", args, { cwd: root })).stdout;
}

async function identityFor(root: string, path: string): Promise<Pick<CanonicalWorktreeEntry, "worktreeMode" | "worktreeContentHash" | "deletionMarker" | "symlinkTargetHash">> {
  try {
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) {
      const targetHash = createHash("sha256").update(await readlink(join(root, path)), "utf8").digest("hex");
      return { worktreeMode: "symlink", worktreeContentHash: targetHash, symlinkTargetHash: targetHash };
    }
    return { worktreeMode: `file:${stat.mode.toString(8)}`, worktreeContentHash: createHash("sha256").update(await readFile(join(root, path))).digest("hex") };
  } catch {
    return { worktreeMode: "missing", deletionMarker: true };
  }
}

/** Parse Git porcelain v2 NUL records into sorted, fixed-shape current-state entries. */
export async function buildCanonicalWorktreeInventory(repositoryRoot: string): Promise<CanonicalWorktreeEntry[]> {
  const records = (await gitOutput(repositoryRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all"])).split("\0");
  const entries: CanonicalWorktreeEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.startsWith("! ")) continue;
    if (record.startsWith("? ")) {
      const path = normalisePath(record.slice(2));
      if (isContinuumStatePath(path)) continue;
      entries.push({ path, recordType: "untracked", indexState: "?", worktreeState: "?", ...(await identityFor(repositoryRoot, path)) });
      continue;
    }
    const fields = record.split(" ");
    if (record.startsWith("u ")) {
      const path = normalisePath(fields.slice(10).join(" "));
      if (isContinuumStatePath(path)) continue;
      entries.push({ path, recordType: "unmerged", indexState: fields[1]?.[0] ?? "u", worktreeState: fields[1]?.[1] ?? "u", headMode: fields[3], indexMode: fields[4], worktreeMode: fields[5], headObjectId: fields[6], indexObjectId: fields[7], ...(await identityFor(repositoryRoot, path)) });
      continue;
    }
    if (!record.startsWith("1 ") && !record.startsWith("2 ")) continue;
    const renameOrCopy = record.startsWith("2 ");
    const path = normalisePath(fields.slice(renameOrCopy ? 9 : 8).join(" "));
    const originalPath = renameOrCopy ? normalisePath(records[++index] ?? "") : undefined;
    if (isContinuumStatePath(path) && (!originalPath || isContinuumStatePath(originalPath))) continue;
    entries.push({ path, ...(originalPath ? { originalPath } : {}), recordType: renameOrCopy ? "rename_or_copy" : "ordinary", indexState: fields[1]?.[0] ?? " ", worktreeState: fields[1]?.[1] ?? " ", headMode: fields[3], indexMode: fields[4], worktreeMode: fields[5], headObjectId: fields[6], indexObjectId: fields[7], ...(await identityFor(repositoryRoot, path)) });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path) || (left.originalPath ?? "").localeCompare(right.originalPath ?? "") || left.recordType.localeCompare(right.recordType));
}

export function serializeCanonicalWorktreeInventory(entries: CanonicalWorktreeEntry[]): string {
  return `${entries.map((entry) => JSON.stringify({ path: entry.path, originalPath: entry.originalPath ?? null, recordType: entry.recordType, indexState: entry.indexState, worktreeState: entry.worktreeState, headMode: entry.headMode ?? null, indexMode: entry.indexMode ?? null, worktreeMode: entry.worktreeMode ?? null, headObjectId: entry.headObjectId ?? null, indexObjectId: entry.indexObjectId ?? null, worktreeContentHash: entry.worktreeContentHash ?? null, deletionMarker: entry.deletionMarker ?? false, symlinkTargetHash: entry.symlinkTargetHash ?? null })).join("\n")}\n`;
}

export function hashCanonicalWorktreeInventory(entries: CanonicalWorktreeEntry[]): string {
  return createHash("sha256").update(serializeCanonicalWorktreeInventory(entries), "utf8").digest("hex");
}

export async function resolveSnapshotIdentity(cwd: string): Promise<IndexSnapshotIdentity> {
  const root = await getRepositoryRoot(cwd);
  const base_commit_hash = await getCurrentCommit(root);
  if (!base_commit_hash) throw new Error("Cannot resolve snapshot identity: repository has no commits.");
  const entries = await buildCanonicalWorktreeInventory(root);
  return entries.length ? { snapshot_kind: "worktree", base_commit_hash, worktree_hash: hashCanonicalWorktreeInventory(entries), dirty: true } : { snapshot_kind: "commit", base_commit_hash, worktree_hash: null, dirty: false };
}
