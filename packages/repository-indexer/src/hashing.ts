import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getRepositoryRoot } from "@continuum/git-analyzer";

/**
 * Computes the SHA-256 hash of a file's contents.
 * Used for stable context item hashing.
 */
export async function hashFile(absolutePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolutePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Hash string content directly.
 */
export function hashString(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface IncrementalFileStatus {
  changed: boolean;
  hash: string;
  sizeBytes: number;
}

/**
 * Compute the worktree hash from a path-to-hash map.
 * Sorts paths to ensure deterministic hashing.
 */
export function computeWorktreeHash(pathHashes: Map<string, string>): string {
  const sortedPaths = Array.from(pathHashes.keys()).sort();
  const hash = createHash("sha256");
  
  for (const path of sortedPaths) {
    hash.update(`${path}:${pathHashes.get(path)!}\n`);
  }
  
  return hash.digest("hex");
}
