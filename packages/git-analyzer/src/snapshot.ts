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

/** Parse porcelain v2 without guessing field counts or splitting paths on whitespace. */
export function parsePorcelainInventory(output: string): CanonicalWorktreeEntry[] {
  const nul = output.includes("\0"), records = output.split(nul ? "\0" : "\n"), entries: CanonicalWorktreeEntry[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || record.startsWith("#") || record.startsWith("!")) continue;
    if (record.startsWith("? ")) { entries.push({ path: normalisePath(record.slice(2)), recordType: "untracked", indexState: "?", worktreeState: "?" }); continue; }
    const fields = record.split(" "), type = fields[0];
    if (!["1", "2", "u"].includes(type ?? "")) continue;
    const offset = type === "1" ? 8 : type === "2" ? 9 : 10;
    const rawPath = fields.slice(offset).join(" ");
    const [path, textOriginal] = nul ? [rawPath, undefined] : rawPath.split("\t");
    const originalPath = type === "2" ? (nul ? records[++index] : textOriginal) : undefined;
    entries.push({ path: normalisePath(path ?? ""), ...(originalPath ? { originalPath: normalisePath(originalPath) } : {}), recordType: type === "u" ? "unmerged" : type === "2" ? "rename_or_copy" : "ordinary", indexState: fields[1]?.[0] ?? " ", worktreeState: fields[1]?.[1] ?? " ", headMode: fields[3], indexMode: fields[4], worktreeMode: fields[5], headObjectId: fields[6], indexObjectId: fields[7] });
  }
  return entries.sort((a,b) => a.path.localeCompare(b.path));
}

export async function buildCanonicalWorktreeInventory(repositoryRoot: string): Promise<CanonicalWorktreeEntry[]> {
  const entries = parsePorcelainInventory(await gitOutput(repositoryRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]));
  return Promise.all(entries.map(async entry => ({ ...entry, ...(await identityFor(repositoryRoot, entry.path)) })));
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
