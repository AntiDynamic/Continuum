/**
 * Git repository inspection using real Git commands through Execa.
 *
 * SAFETY RULES — this module must never:
 * - git reset
 * - git checkout
 * - git clean
 * - git stash
 * - git commit
 * - git push
 * - delete or modify any user file
 *
 * It is read-only.  All mutations to the repository go through user-approved
 * agent runs, never through Continuum itself.
 */

import { execa } from "execa";
import { join } from "node:path";
import {
  GitError,
  NotARepositoryError,
  normalisePath,
  now,
  createLogger,
} from "@continuum/shared";
import type { AttributionConfidence, ChangeType } from "@continuum/shared";

const log = createLogger("git-analyzer");

/** Run a git command in the given directory and return trimmed stdout. */
async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execa("git", args, { cwd, reject: true });
    return result.stdout.trim();
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : `git ${args.join(" ")} failed`;
    throw new GitError(message, err);
  }
}

/** Run git and return empty string on failure (for optional operations). */
async function gitOptional(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execa("git", args, { cwd, reject: false });
    return (result.stdout ?? "").trim();
  } catch {
    return "";
  }
}

/** Return true when the path is inside a git repository. */
export async function isGitRepository(path: string): Promise<boolean> {
  try {
    await git(path, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return the absolute path to the repository root.
 * Throws NotARepositoryError when the path is not inside a git repo.
 */
export async function getRepositoryRoot(cwd: string): Promise<string> {
  try {
    const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
    return normalisePath(root);
  } catch {
    throw new NotARepositoryError(cwd);
  }
}

/** Return the current branch name, or null for a detached HEAD. */
export async function getCurrentBranch(root: string): Promise<string | null> {
  try {
    const branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}

/** Return the current commit hash (full SHA). */
export async function getCurrentCommit(root: string): Promise<string | null> {
  try {
    return await git(root, ["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

/**
 * Return the porcelain v2 status output.
 * This format is stable across git versions and includes rename detection.
 */
export async function getPorcelainStatus(root: string): Promise<string> {
  return gitOptional(root, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"]);
}

/** Return true when the working tree has no uncommitted changes. */
export async function isWorkingTreeClean(root: string): Promise<boolean> {
  const status = await gitOptional(root, ["status", "--porcelain"]);
  return status === "";
}

export interface GitSnapshot {
  commitHash: string | null;
  branch: string | null;
  statusPorcelain: string;
  capturedAt: string;
  pathHashes: Record<string, string>;
}

/** Capture a complete snapshot of the current repository state. */
export async function captureSnapshot(root: string): Promise<GitSnapshot> {
  const [commitHash, branch, statusPorcelain] = await Promise.all([
    getCurrentCommit(root),
    getCurrentBranch(root),
    getPorcelainStatus(root),
  ]);
  const paths = [...extractDirtyPaths(statusPorcelain)].sort();
  const pathHashes = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        (await gitOptional(root, ["hash-object", "--", path])) || "<missing>",
      ]),
    ),
  );

  return {
    commitHash,
    branch,
    statusPorcelain,
    pathHashes,
    capturedAt: now(),
  };
}

export interface FileDelta {
  pathBefore?: string;
  pathAfter?: string;
  changeType: ChangeType;
  additions?: number;
  deletions?: number;
  binary: boolean;
  attributionConfidence: AttributionConfidence;
}

/**
 * Parse a single line from `git diff --numstat` output.
 *
 * Format:  <additions>\t<deletions>\t<path>
 * Binary:  -\t-\t<path>
 * Rename:  <add>\t<del>\t{before => after}
 */
function parseDiffNumstatLine(
  line: string,
): Omit<FileDelta, "attributionConfidence"> | null {
  const parts = line.split("\t");
  if (parts.length < 3) return null;

  const [addStr, delStr, ...pathParts] = parts;
  const pathStr = pathParts.join("\t");

  const binary = addStr === "-" && delStr === "-";
  const additions = binary ? undefined : parseInt(addStr ?? "0", 10);
  const deletions = binary ? undefined : parseInt(delStr ?? "0", 10);

  const renameMatch = pathStr.match(/^(.*)\{(.+) => (.+)\}(.*)$/);
  if (renameMatch) {
    const [, prefix, before, after, suffix] = renameMatch;
    const result: Omit<FileDelta, "attributionConfidence"> = {
      pathBefore: `${prefix ?? ""}${before ?? ""}${suffix ?? ""}`.replace(/\/\//g, "/"),
      pathAfter: `${prefix ?? ""}${after ?? ""}${suffix ?? ""}`.replace(/\/\//g, "/"),
      changeType: "renamed",
      binary,
    };
    if (additions !== undefined) result.additions = additions;
    if (deletions !== undefined) result.deletions = deletions;
    return result;
  }

  const result: Omit<FileDelta, "attributionConfidence"> = {
    pathAfter: pathStr,
    changeType: binary ? "binary" : "modified",
    binary,
  };
  if (additions !== undefined) result.additions = additions;
  if (deletions !== undefined) result.deletions = deletions;
  return result;
}

/**
 * Parse porcelain v2 status to identify added/deleted/untracked files
 * that would not appear in a diff against a commit (e.g. new untracked files).
 */
function parsePorcelainForNewFiles(porcelain: string): string[] {
  const untracked: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("? ")) {
      untracked.push(line.slice(2).trim());
    }
  }
  return untracked;
}

/**
 * Compute file-level changes between two git states.
 *
 * Attribution confidence:
 * - HIGH when the file was clean before the run.
 * - MEDIUM for newly untracked files.
 * - LOW for files that were already dirty before the run.
 * - UNKNOWN when baseline information is insufficient.
 */
export async function computeDelta(
  root: string,
  beforeSnapshot: GitSnapshot,
  afterSnapshot: GitSnapshot,
  dirtyPathsBefore: Set<string>,
): Promise<FileDelta[]> {
  const deltas: FileDelta[] = [];

  if (
    beforeSnapshot.commitHash === afterSnapshot.commitHash &&
    JSON.stringify(beforeSnapshot.pathHashes) === JSON.stringify(afterSnapshot.pathHashes)
  ) {
    return [];
  }

  if (beforeSnapshot.commitHash && afterSnapshot.commitHash) {
    // If commits differ, use diff between them for accurate attribution.
    // If same commit, use diff against working tree.
    const fromRef = beforeSnapshot.commitHash;
    const toRef =
      beforeSnapshot.commitHash !== afterSnapshot.commitHash
        ? afterSnapshot.commitHash
        : null;

    const diffArgs = toRef
      ? ["diff", "--numstat", fromRef, toRef]
      : ["diff", "--numstat", fromRef];

    const diffOutput = await gitOptional(root, diffArgs);
    for (const line of diffOutput.split("\n")) {
      if (!line.trim()) continue;
      const parsed = parseDiffNumstatLine(line);
      if (!parsed) continue;

      const relevantPath = parsed.pathAfter ?? parsed.pathBefore ?? "";
      if (beforeSnapshot.commitHash === afterSnapshot.commitHash) {
        const beforePath = parsed.pathBefore ?? relevantPath;
        const afterPath = parsed.pathAfter ?? relevantPath;
        if (
          beforeSnapshot.pathHashes[beforePath] ===
          afterSnapshot.pathHashes[afterPath]
        ) {
          continue;
        }
      }

      const confidence: AttributionConfidence = dirtyPathsBefore.has(
        relevantPath,
      )
        ? "low"
        : "high";

      deltas.push({ ...parsed, attributionConfidence: confidence });
    }
  }

  // Add untracked files from after-snapshot that weren't in before-snapshot.
  const untrackedBefore = new Set(
    parsePorcelainForNewFiles(beforeSnapshot.statusPorcelain),
  );
  const untrackedAfter = parsePorcelainForNewFiles(
    afterSnapshot.statusPorcelain,
  );

  for (const path of untrackedAfter) {
    if (!untrackedBefore.has(path)) {
      deltas.push({
        pathAfter: path,
        changeType: "untracked",
        binary: false,
        attributionConfidence: "medium",
      });
    }
  }

  for (const path of untrackedAfter) {
    if (
      untrackedBefore.has(path) &&
      beforeSnapshot.pathHashes[path] !== afterSnapshot.pathHashes[path] &&
      !deltas.some((delta) => (delta.pathAfter ?? delta.pathBefore) === path)
    ) {
      deltas.push({
        pathAfter: path,
        changeType: "modified",
        binary: false,
        attributionConfidence: "low",
      });
    }
  }

  log.debug("Delta computed", { count: deltas.length, root });
  return deltas;
}

/**
 * Extract the set of dirty (modified or untracked) file paths from
 * a porcelain status string.
 */
export function extractDirtyPaths(porcelain: string): Set<string> {
  const paths = new Set<string>();
  for (const line of porcelain.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Porcelain v1 format: XY path
    // Porcelain v2 starts with "1 ", "2 ", "u ", "? " or "#"
    if (trimmed.startsWith("# ") || trimmed.startsWith("? ")) {
      if (trimmed.startsWith("? ")) {
        paths.add(trimmed.slice(2).trim());
      }
      continue;
    }

    // v2 changed entries
    const v2Match = trimmed.match(/^[12u]\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/);
    if (v2Match?.[1]) {
      paths.add(v2Match[1].trim());
      continue;
    }

    // v1 format fallback
    if (trimmed.length > 3) {
      paths.add(trimmed.slice(3).trim());
    }
  }
  return paths;
}

/** Return diff statistics (insertions, deletions) between two commits. */
export async function getDiffStats(
  root: string,
  fromCommit: string,
  toCommit: string,
): Promise<{ insertions: number; deletions: number }> {
  const output = await gitOptional(root, [
    "diff",
    "--shortstat",
    fromCommit,
    toCommit,
  ]);
  const insertions =
    parseInt(output.match(/(\d+) insertion/)?.[1] ?? "0", 10);
  const deletions =
    parseInt(output.match(/(\d+) deletion/)?.[1] ?? "0", 10);
  return { insertions, deletions };
}

/** Return the full git diff patch as a string. */
export async function getDiffPatch(
  root: string,
  fromRef: string,
  toRef?: string,
): Promise<string> {
  const args = toRef
    ? ["diff", fromRef, toRef]
    : ["diff", fromRef];
  return gitOptional(root, args);
}

/** Check whether Git is available on the system. */
export async function isGitAvailable(): Promise<boolean> {
  try {
    await execa("git", ["--version"], { reject: true });
    return true;
  } catch {
    return false;
  }
}

/** Return git version string. */
export async function getGitVersion(): Promise<string | null> {
  try {
    const result = await execa("git", ["--version"], { reject: false });
    return result.stdout.trim();
  } catch {
    return null;
  }
}
