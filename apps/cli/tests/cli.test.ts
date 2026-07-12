import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { resolve, dirname } from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("CLI Integration", () => {
  let tempDir: string;
  const cliBin = resolve(__dirname, "../dist/main.js");

  beforeAll(async () => {
    tempDir = await mkdtemp(resolve(tmpdir(), "continuum-cli-test-"));
    // Initialize a git repository so Continuum commands work
    await execa("git", ["init"], { cwd: tempDir });
    await execa("git", ["config", "user.name", "Test User"], { cwd: tempDir });
    await execa("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await execa("git", ["commit", "--allow-empty", "-m", "Initial commit"], { cwd: tempDir });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should have tests for doctor", async () => {
    const result = await execa("node", [cliBin, "doctor"], { cwd: tempDir, reject: false, timeout: 5000 });
    expect(result.stdout).toContain("Continuum Doctor");
  }, 10000);
  
  it("should have tests for init", async () => {
    const initDir = resolve(tempDir, "init-test");
    await mkdir(initDir);
    await execa("git", ["init"], { cwd: initDir });
    const result = await execa("node", [cliBin, "init", "--non-interactive"], { cwd: initDir, reject: false });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Continuum initialised successfully.");
  });

  it("should gracefully fail with an unknown agent", async () => {
    const runDir = resolve(tempDir, "run-unknown-test");
    await mkdir(runDir);
    await execa("git", ["init"], { cwd: runDir });
    await execa("node", [cliBin, "init", "--non-interactive"], { cwd: runDir });
    const result = await execa("node", [cliBin, "run", "--agent", "unknown-agent", "--non-interactive", "test task"], { cwd: runDir, reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown agent: \"unknown-agent\"");
  });

  describe("Successful Workflow with Fake Adapter", () => {
    let runDir: string;
    let runIdA: string;
    let runIdB: string;

    beforeAll(async () => {
      runDir = resolve(tempDir, "success-workflow");
      await mkdir(runDir);
      await execa("git", ["init"], { cwd: runDir });
      await execa("git", ["config", "user.name", "Test User"], { cwd: runDir });
      await execa("git", ["config", "user.email", "test@example.com"], { cwd: runDir });
      
      // Setup fake project
      await mkdir(resolve(runDir, "src"));
      await writeFile(resolve(runDir, "src/calculator.ts"), "export function factorial(n) { return 0; }");
      
      // Setup a check script instead of vitest
      // Fails if output is 0, passes if output is 1
      await writeFile(resolve(runDir, "check.js"), `
        const fs = require('fs');
        const code = fs.readFileSync('src/calculator.ts', 'utf8');
        if (code.includes('return 0')) process.exit(1);
        process.exit(0);
      `);

      await execa("git", ["add", "."], { cwd: runDir });
      await execa("git", ["commit", "-m", "Initial calculator code"], { cwd: runDir });

      // Init continuum
      await execa("node", [cliBin, "init", "--non-interactive"], { cwd: runDir });
      
      // Override test command in continuum.yaml or config.json
      const configPath = resolve(runDir, ".continuum/config.json");
      const config = JSON.parse(await import("node:fs/promises").then(m => m.readFile(configPath, "utf8")));
      config.testCommands = ["node check.js"];
      await writeFile(configPath, JSON.stringify(config, null, 2));
    });

    it("should complete a successful agent run", async () => {
      // Run the agent. The agent starts, check.js fails (exit 1), agent runs, 
      // fake agent edits the file via our backdoor, check.js passes (exit 0)
      const result = await execa("node", [cliBin, "run", "Fix factorial zero handling"], { 
        cwd: runDir, 
        reject: false,
        env: {
          ...process.env,
          CONTINUUM_TEST_FAKE_ADAPTER: "1",
          CONTINUUM_TEST_FAKE_ADAPTER_EDIT_FILE: "src/calculator.ts",
          CONTINUUM_TEST_FAKE_ADAPTER_EDIT_CONTENT: "export function factorial(n) { return 1; }"
        }
      });
      
      if (result.exitCode !== 0) {
        console.error("Agent run stdout:", result.stdout);
        console.error("Agent run stderr:", result.stderr);
      }
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Agent completed");
      
      // Extract runId from output
      const runIdMatch = result.stdout.match(/Run ID\s+([a-zA-Z0-9-]+)/);
      expect(runIdMatch).toBeDefined();
      if (runIdMatch) {
        runIdA = runIdMatch[1];
      }
    });

    it("should report the successful run", async () => {
      const result = await execa("node", [cliBin, "report", "latest"], { cwd: runDir, reject: false });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Fix factorial zero handling");
      expect(result.stdout).toContain("completed");
    });

    it("should allow setting an outcome", async () => {
      const result = await execa("node", [cliBin, "outcome", "latest", "--non-interactive"], { cwd: runDir, reject: false });
      if (result.exitCode !== 0) {
        console.error("Outcome error:", result.stderr, result.stdout);
      }
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Outcome recorded");
    });

    it("should allow a failed agent run to compare", async () => {
      // Restore bug
      await writeFile(resolve(runDir, "src/calculator.ts"), "export function factorial(n) { return 0; }");
      await execa("git", ["add", "."], { cwd: runDir });
      await execa("git", ["commit", "-m", "Restore bug"], { cwd: runDir });

      const result = await execa("node", [cliBin, "run", "Fail at fixing"], { 
        cwd: runDir, 
        reject: false,
        env: {
          ...process.env,
          CONTINUUM_TEST_FAKE_ADAPTER: "1",
          // Don't fix the file, so final test fails
        }
      });
      if (result.exitCode !== 0 && !result.stdout.match(/Run ID/)) {
        console.error("Failed run stdout:", result.stdout);
        console.error("Failed run stderr:", result.stderr);
      }
      expect(result.exitCode).toBe(0);
      
      const runIdMatch = result.stdout.match(/Run ID\s+([a-zA-Z0-9-]+)/);
      if (runIdMatch) {
        runIdB = runIdMatch[1];
      }
    });

    it("should compare the two runs", async () => {
      expect(runIdA).toBeDefined();
      expect(runIdB).toBeDefined();
      
      const result = await execa("node", [cliBin, "compare", runIdA, runIdB], { cwd: runDir, reject: false });
      expect(result.exitCode).toBe(0);
      
      const out = result.stdout + result.stderr;
      expect(out).toContain("Run A has fewer test failures");
    });
  });

  describe("Error Path Coverage", () => {
    it("should fail gracefully when report is run without initialized repo", async () => {
      const errDir = resolve(tempDir, "uninit-err-test");
      await mkdir(errDir);
      await execa("git", ["init"], { cwd: errDir });
      const result = await execa("node", [cliBin, "report"], { cwd: errDir, reject: false });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Continuum is not initialised");
    });
    
    it("should fail gracefully when comparing non-existent runs", async () => {
      const errDir = resolve(tempDir, "compare-err-test");
      await mkdir(errDir);
      await execa("git", ["init"], { cwd: errDir });
      await execa("node", [cliBin, "init", "--non-interactive"], { cwd: errDir });
      const result = await execa("node", [cliBin, "compare", "a", "b"], { cwd: errDir, reject: false });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Run \"a\" was not found in the database");
    });
  });
});
