import { describe, it, expect } from "vitest";
import { hashString, computeWorktreeHash, hashFile } from "../src/hashing.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
describe("hashing", () => {
    it("hashString produces consistent sha256 hex", () => {
        const content = "hello world";
        const hash = hashString(content);
        // echo -n "hello world" | sha256sum
        expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    });
    it("hashFile produces the same hash as hashString for identical content", async () => {
        const content = "file content\nwith multiple lines\n";
        const tmpFile = join(tmpdir(), `continuum-test-hash-${Date.now()}.txt`);
        try {
            writeFileSync(tmpFile, content);
            const fileHash = await hashFile(tmpFile);
            const stringHash = hashString(content);
            expect(fileHash).toBe(stringHash);
        }
        finally {
            try {
                unlinkSync(tmpFile);
            }
            catch { }
        }
    });
    it("computeWorktreeHash produces deterministic hash regardless of insertion order", () => {
        const map1 = new Map();
        map1.set("b/file.ts", "hash2");
        map1.set("a/file.ts", "hash1");
        const map2 = new Map();
        map2.set("a/file.ts", "hash1");
        map2.set("b/file.ts", "hash2");
        const hash1 = computeWorktreeHash(map1);
        const hash2 = computeWorktreeHash(map2);
        expect(hash1).toBe(hash2);
        expect(hash1).toBeTruthy();
    });
});
//# sourceMappingURL=hashing.test.js.map