import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverFiles } from "../src/discovery.js";
import * as gitAnalyzer from "@continuum/git-analyzer";
import { execa } from "execa";
import * as fsPromises from "node:fs/promises";
vi.mock("@continuum/git-analyzer");
vi.mock("execa");
vi.mock("node:fs/promises");
describe("discovery", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(gitAnalyzer.isGitRepository).mockResolvedValue(true);
        vi.mocked(gitAnalyzer.getRepositoryRoot).mockResolvedValue("/mock/repo");
    });
    it("returns git files excluding .continuumignore matches", async () => {
        vi.mocked(execa).mockResolvedValue({
            stdout: "file1.ts\0file2.ts\0ignored.ts\0.git/config\0",
        });
        vi.mocked(fsPromises.readFile).mockResolvedValue("ignored.ts\n");
        const files = await discoverFiles("/mock/repo");
        expect(files).toEqual(["file1.ts", "file2.ts"]); // .git is ignored by default
    });
    it("handles missing .continuumignore", async () => {
        vi.mocked(execa).mockResolvedValue({
            stdout: "file1.ts\0file2.ts\0",
        });
        const error = new Error("ENOENT");
        error.code = "ENOENT";
        vi.mocked(fsPromises.readFile).mockRejectedValue(error);
        const files = await discoverFiles("/mock/repo");
        expect(files).toEqual(["file1.ts", "file2.ts"]);
    });
});
//# sourceMappingURL=discovery.test.js.map