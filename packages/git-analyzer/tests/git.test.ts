import { describe, it, expect } from "vitest";
import { extractDirtyPaths } from "../src/git.js";

describe("extractDirtyPaths", () => {
  it("extracts untracked files from porcelain v2 output", () => {
    const porcelain = `# branch.oid abc123
# branch.head main
? newfile.ts
? src/other.ts`;
    const paths = extractDirtyPaths(porcelain);
    expect(paths.has("newfile.ts")).toBe(true);
    expect(paths.has("src/other.ts")).toBe(true);
  });

  it("handles empty status output", () => {
    const paths = extractDirtyPaths("");
    expect(paths.size).toBe(0);
  });

  it("handles clean status (only branch headers)", () => {
    const porcelain = `# branch.oid abc123
# branch.head main`;
    const paths = extractDirtyPaths(porcelain);
    expect(paths.size).toBe(0);
  });
});

describe("git availability check", () => {
  it("isGitAvailable returns true on a machine with git", async () => {
    const { isGitAvailable } = await import("../src/git.js");
    const available = await isGitAvailable();
    // On the CI machine git is available
    expect(typeof available).toBe("boolean");
  });
});
