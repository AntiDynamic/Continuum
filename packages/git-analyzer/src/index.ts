export {
  isGitRepository,
  getRepositoryRoot,
  getCurrentBranch,
  getCurrentCommit,
  getPorcelainStatus,
  isWorkingTreeClean,
  captureSnapshot,
  computeDelta,
  extractDirtyPaths,
  getDiffStats,
  getDiffPatch,
  isGitAvailable,
  getGitVersion,
} from "./git.js";
export type { GitSnapshot, FileDelta } from "./git.js";
