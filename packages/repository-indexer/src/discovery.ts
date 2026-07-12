import { execa } from "execa";
import ignore from "ignore";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getRepositoryRoot, isGitRepository } from "@continuum/git-analyzer";
import { normalisePath } from "@continuum/shared";

/**
 * Discover all tracked and untracked (but not git-ignored) files in a repository.
 * Further filters out files matched by .continuumignore in the root (if present).
 * Returns paths relative to the repository root.
 */
export async function discoverFiles(cwd: string): Promise<string[]> {
  const isRepo = await isGitRepository(cwd);
  if (!isRepo) {
    throw new Error(`Path is not a git repository: ${cwd}`);
  }

  const root = await getRepositoryRoot(cwd);
  
  // Get all files that git knows about (tracked + untracked), excluding .gitignore matches
  const { stdout } = await execa("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root });
  
  if (!stdout) {
    return [];
  }
  
  // Split by null byte and remove empty strings
  const gitFiles = stdout.split("\0").filter(Boolean);
  
  // Load .continuumignore if it exists
  const ig = ignore();
  
  // Always ignore .git/ by default, although git ls-files won't return it anyway
  ig.add([".git"]);

  try {
    const continuumIgnorePath = join(root, ".continuumignore");
    const content = await readFile(continuumIgnorePath, "utf-8");
    ig.add(content);
  } catch (err: any) {
    // Ignore ENOENT (file not found), throw for other errors
    if (err.code !== "ENOENT") {
      throw err;
    }
  }

  return gitFiles
    .map(normalisePath)
    .filter((file: string) => !ig.ignores(file));
}
