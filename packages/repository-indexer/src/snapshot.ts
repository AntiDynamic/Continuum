import {
  getRepositoryRoot,
  getCurrentCommit,
  isWorkingTreeClean
} from "@continuum/git-analyzer";
import type { IndexSnapshotIdentity } from "@continuum/shared";

/**
 * Resolves the snapshot identity of the repository at the given path.
 * Determines if the repository is clean or dirty and returns the corresponding identity.
 * 
 * Note: The worktree_hash is initialized to null. For a dirty repository, 
 * the indexer must compute the hash of the path/content-hash map during the 
 * indexing phase and update this identity before persisting the run.
 */
export async function resolveSnapshotIdentity(cwd: string): Promise<IndexSnapshotIdentity> {
  const root = await getRepositoryRoot(cwd);
  const commitHash = await getCurrentCommit(root);
  
  if (!commitHash) {
    throw new Error("Cannot resolve snapshot identity: Repository has no commits.");
  }

  const clean = await isWorkingTreeClean(root);

  if (clean) {
    return {
      snapshot_kind: "commit",
      base_commit_hash: commitHash,
      worktree_hash: null,
      dirty: false,
    };
  } else {
    return {
      snapshot_kind: "worktree",
      base_commit_hash: commitHash,
      worktree_hash: null, // To be filled during indexing
      dirty: true,
    };
  }
}
