import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { resolve, dirname } from "node:path";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
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
    // Create a sub temp dir for init
    const initDir = resolve(tempDir, "init-test");
    await mkdir(initDir);
    await execa("git", ["init"], { cwd: initDir });
    const result = await execa("node", [cliBin, "init", "--non-interactive"], { cwd: initDir, reject: false });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Continuum initialised successfully.");
  });

  it("should have tests for run", async () => {
    // Since we don't have a real agent, we can try running an unknown agent and it should fail gracefully
    const runDir = resolve(tempDir, "run-test");
    await mkdir(runDir);
    await execa("git", ["init"], { cwd: runDir });
    await execa("node", [cliBin, "init", "--non-interactive"], { cwd: runDir });
    const result = await execa("node", [cliBin, "run", "--agent", "unknown-agent", "--non-interactive", "test task"], { cwd: runDir, reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown agent: \"unknown-agent\"");
  });

  it("should have tests for report", async () => {
    await execa("node", [cliBin, "init", "--non-interactive"], { cwd: tempDir });
    const result = await execa("node", [cliBin, "report"], { cwd: tempDir, reject: false });
    // May fail since there are no runs, but should output something reasonable
    expect(result.exitCode).toBe(1); // It probably exits with 1 if no runs found
    expect(result.stderr).toContain("No runs found"); // Let's check what report outputs when no runs
  });

  it("should have tests for outcome", async () => {
    const result = await execa("node", [cliBin, "outcome", "latest", "--non-interactive"], { cwd: tempDir, reject: false });
    // Needs a run to record an outcome for
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("No runs found"); 
  });

  it("should have tests for compare", async () => {
    const result = await execa("node", [cliBin, "compare", "a", "b"], { cwd: tempDir, reject: false });
    // Doesn't exist run a and b
    expect(result.exitCode).not.toBe(0);
  });
});
