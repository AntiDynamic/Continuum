import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveSnapshotIdentity } from "../src/snapshot.js";
import * as gitAnalyzer from "@continuum/git-analyzer";

vi.mock("@continuum/git-analyzer");

describe("snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitAnalyzer.getRepositoryRoot).mockResolvedValue("/mock/repo");
    vi.mocked(gitAnalyzer.resolveSnapshotIdentity).mockResolvedValue({ snapshot_kind: "commit", base_commit_hash: "abcdef1234567890", worktree_hash: null, dirty: false });
  });

  it("returns commit snapshot when working tree is clean", async () => {
    vi.mocked(gitAnalyzer.resolveSnapshotIdentity).mockResolvedValue({ snapshot_kind: "commit", base_commit_hash: "abcdef1234567890", worktree_hash: null, dirty: false });

    const result = await resolveSnapshotIdentity("/mock/repo/some/path");
    
    expect(result).toEqual({
      snapshot_kind: "commit",
      base_commit_hash: "abcdef1234567890",
      worktree_hash: null,
      dirty: false,
    });
  });

  it("returns worktree snapshot when working tree is dirty", async () => {
    vi.mocked(gitAnalyzer.resolveSnapshotIdentity).mockResolvedValue({ snapshot_kind: "worktree", base_commit_hash: "abcdef1234567890", worktree_hash: "deterministic-worktree-hash", dirty: true });

    const result = await resolveSnapshotIdentity("/mock/repo/some/path");
    
    expect(result).toEqual({
      snapshot_kind: "worktree",
      base_commit_hash: "abcdef1234567890",
      worktree_hash: "deterministic-worktree-hash",
      dirty: true,
    });
  });

  it("throws if there is no commit hash", async () => {
    vi.mocked(gitAnalyzer.resolveSnapshotIdentity).mockRejectedValue(new Error("repository has no commits"));
    await expect(resolveSnapshotIdentity("/mock/repo")).rejects.toThrow(/no commits/);
  });
});
