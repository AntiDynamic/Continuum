import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveSnapshotIdentity } from "../src/snapshot.js";
import * as gitAnalyzer from "@continuum/git-analyzer";
vi.mock("@continuum/git-analyzer");
describe("snapshot", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(gitAnalyzer.getRepositoryRoot).mockResolvedValue("/mock/repo");
    });
    it("returns commit snapshot when working tree is clean", async () => {
        vi.mocked(gitAnalyzer.getCurrentCommit).mockResolvedValue("abcdef1234567890");
        vi.mocked(gitAnalyzer.isWorkingTreeClean).mockResolvedValue(true);
        const result = await resolveSnapshotIdentity("/mock/repo/some/path");
        expect(result).toEqual({
            snapshot_kind: "commit",
            base_commit_hash: "abcdef1234567890",
            worktree_hash: null,
            dirty: false,
        });
    });
    it("returns worktree snapshot when working tree is dirty", async () => {
        vi.mocked(gitAnalyzer.getCurrentCommit).mockResolvedValue("abcdef1234567890");
        vi.mocked(gitAnalyzer.isWorkingTreeClean).mockResolvedValue(false);
        const result = await resolveSnapshotIdentity("/mock/repo/some/path");
        expect(result).toEqual({
            snapshot_kind: "worktree",
            base_commit_hash: "abcdef1234567890",
            worktree_hash: null,
            dirty: true,
        });
    });
    it("throws if there is no commit hash", async () => {
        vi.mocked(gitAnalyzer.getCurrentCommit).mockResolvedValue(null);
        await expect(resolveSnapshotIdentity("/mock/repo")).rejects.toThrow(/no commits/);
    });
});
//# sourceMappingURL=snapshot.test.js.map