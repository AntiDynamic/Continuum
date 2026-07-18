/**
 * continuum doctor — health check for the Continuum environment.
 */

import { execa } from "execa";
import { isGitRepository, isGitAvailable, getGitVersion, isWorkingTreeClean, getRepositoryRoot } from "@continuum/git-analyzer";
import { GeminiAdapter } from "@continuum/gemini-adapter";
import {
  section, pass, fail, warn, info, line, blank, printError, bold, dim
} from "../display.js";
import { isInitialised, getContinuumDir } from "../config-helpers.js";
import { access, constants } from "node:fs/promises";

const NODE_VERSION_MINIMUM = 18;

async function checkNodeVersion(): Promise<boolean> {
  const ver = process.version; // "v24.13.0"
  const major = parseInt(ver.slice(1).split(".")[0] ?? "0", 10);
  if (major >= NODE_VERSION_MINIMUM) {
    pass(`Node.js ${ver}`, `minimum v${NODE_VERSION_MINIMUM.toString()}`);
    return true;
  } else {
    fail(`Node.js ${ver}`, `minimum v${NODE_VERSION_MINIMUM.toString()} required`);
    return false;
  }
}

async function checkPnpm(): Promise<boolean> {
  try {
    const result = await execa("pnpm", ["--version"], { reject: false });
    const version = result.stdout.trim();
    pass(`pnpm ${version}`);
    return true;
  } catch {
    fail("pnpm", "not found — install with: npm install -g pnpm");
    return false;
  }
}

async function checkGit(): Promise<boolean> {
  const available = await isGitAvailable();
  if (!available) {
    fail("Git", "not found — install Git from https://git-scm.com/");
    return false;
  }
  const version = await getGitVersion();
  pass(`Git ${version ?? "(version unknown)"}`);
  return true;
}

async function checkGemini(): Promise<{ ok: boolean; structured: boolean }> {
  const adapter = new GeminiAdapter();
  const availability = await adapter.detectAvailability();
  if (!availability.available) {
    fail(
      "Gemini CLI",
      availability.reason ?? "not found — install with: npm install -g @google/gemini-cli@latest",
    );
    return { ok: false, structured: false };
  }
  pass(`Gemini CLI ${availability.version ?? "(version unknown)"}`, availability.executablePath);

  info(`Gemini version: ${availability.version ?? "unknown"}`);
  if (availability.executablePath) {
    info(`Gemini path: ${availability.executablePath}`);
  }
  
  // Explicitly note trust behaviour
  info("Gemini folder trust is verified only when an actual run begins.");

  const caps = await adapter.getCapabilities();
  if (caps.streamingOutput) {
    pass("Gemini stream-json output", "supported");
  } else if (caps.structuredOutput) {
    warn("Gemini structured output", "json mode only (stream-json not detected)");
  } else {
    warn("Gemini structured output", "not detected — falling back to plain text capture");
  }
  return { ok: true, structured: caps.structuredOutput };
}

async function checkSqlite(cwd: string): Promise<boolean> {
  try {
    // Try importing the database module — this exercises the native module load
    const { openDatabase, migrate, probeSearchCapability } = await import("@continuum/database");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpPath = path.join(os.tmpdir(), `continuum-doctor-${Date.now().toString()}.db`);
    const db = openDatabase(tmpPath);
    migrate(db);
    const searchBackend = probeSearchCapability(db);
    db.close();
    const fs = await import("node:fs");
    fs.unlinkSync(tmpPath);
    pass("SQLite (node:sqlite)", "database open/migrate/close successful");
    if (searchBackend === "fts5") {
      pass("SQLite FTS5", "available");
    } else {
      warn("SQLite FTS5", "unavailable; using fallback lexical search");
    }
    return true;
  } catch (err) {
    fail(
      "SQLite",
      err instanceof Error ? err.message : "unknown error",
    );
    return false;
  }
}

async function checkCurrentRepository(cwd: string): Promise<void> {
  const isGit = await isGitRepository(cwd);
  if (!isGit) {
    warn("Current directory", "not inside a Git repository");
    return;
  }
  pass("Current directory", "inside a Git repository");

  const root = await getRepositoryRoot(cwd);
  const clean = await isWorkingTreeClean(root);
  if (clean) {
    pass("Working tree", "clean");
  } else {
    warn("Working tree", "has uncommitted changes — attribution confidence may be lower");
  }

  const initialised = await isInitialised(root);
  if (initialised) {
    pass("Continuum initialised", getContinuumDir(root));
  } else {
    info("Continuum not initialised", 'Run "continuum init" to set up');
  }
}

export async function runDoctorCommand(options: { cwd?: string }): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  line(bold("Continuum Doctor"));
  line("Checking your environment...");

  section("Runtime");
  await checkNodeVersion();
  await checkPnpm();

  section("Git");
  await checkGit();
  await checkCurrentRepository(cwd);

  section("Agent");
  await checkGemini();

  section("Database");
  await checkSqlite(cwd);

  blank();
  line(dim("Run 'continuum init' in a Git repository to get started."));
  blank();
}
