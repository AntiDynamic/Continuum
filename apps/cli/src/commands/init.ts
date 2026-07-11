/**
 * continuum init — initialise Continuum in the current repository.
 */

import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  getRepositoryRoot,
  isGitRepository,
} from "@continuum/git-analyzer";
import { openDatabase, migrate } from "@continuum/database";
import { DEFAULT_CONFIG } from "@continuum/shared";
import {
  line, section, pass, info, warn, blank, printError, bold, dim, kv
} from "../display.js";
import {
  getContinuumDir,
  getConfigPath,
  getDbPath,
  getRunsDir,
  isInitialised,
  saveConfig,
  detectTestCommands,
  ensureRunsDir,
} from "../config-helpers.js";

async function prompt(question: string, defaultVal?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const displayDefault = defaultVal ? ` [${defaultVal}]` : "";
    rl.question(`${question}${displayDefault}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

async function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await prompt(`${question} ${hint}`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

async function appendToGitignore(repoRoot: string): Promise<void> {
  const gitignorePath = join(repoRoot, ".gitignore");
  const entry = ".continuum/";

  try {
    const existing = await readFile(gitignorePath, "utf-8");
    if (existing.includes(entry)) {
      info(".gitignore", `already contains ${entry}`);
      return;
    }
    await writeFile(
      gitignorePath,
      existing.endsWith("\n") ? existing + entry + "\n" : existing + "\n" + entry + "\n",
      "utf-8",
    );
    pass(".gitignore", `added ${entry}`);
  } catch {
    // .gitignore doesn't exist — create it
    await writeFile(gitignorePath, entry + "\n", "utf-8");
    pass(".gitignore", `created with ${entry}`);
  }
}

export async function runInitCommand(options: {
  cwd?: string;
  nonInteractive?: boolean;
}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const nonInteractive = options.nonInteractive === true;

  line(bold("Continuum Init"));
  blank();

  // Verify we're in a git repository
  const isGit = await isGitRepository(cwd);
  if (!isGit) {
    printError(`"${cwd}" is not inside a Git repository. Continuum requires Git.`);
    process.exit(1);
  }

  const repoRoot = await getRepositoryRoot(cwd);

  // Check for existing configuration
  const alreadyInitialised = await isInitialised(repoRoot);
  if (alreadyInitialised) {
    warn("Continuum is already initialised in this repository.");
    if (!nonInteractive) {
      const overwrite = await promptYesNo(
        "Reinitialise? This will reset your configuration",
        false,
      );
      if (!overwrite) {
        line("Aborted.");
        return;
      }
    } else {
      line("Use --force to reinitialise (not yet supported). Exiting.");
      return;
    }
  }

  info("Repository root", repoRoot);

  // Detect test commands
  const detected = await detectTestCommands(repoRoot);
  let testCommands = detected;

  if (detected.length > 0) {
    info("Detected test commands", detected.join(", "));
    if (!nonInteractive) {
      const keep = await promptYesNo(`Use detected test commands?`, true);
      if (!keep) {
        testCommands = [];
      }
    }
  } else {
    info("No test commands detected automatically.");
    if (!nonInteractive) {
      const customCmd = await prompt(
        "Enter a test command (or leave empty to skip)",
      );
      if (customCmd) testCommands = [customCmd];
    }
  }

  // Build configuration
  const config = {
    ...DEFAULT_CONFIG,
    testCommands,
  };

  // Create .continuum directory structure
  section("Creating .continuum/");

  const continuumDir = getContinuumDir(repoRoot);
  await mkdir(continuumDir, { recursive: true });
  pass(".continuum/", "directory created");

  await ensureRunsDir(repoRoot);
  pass(".continuum/runs/", "directory created");

  await saveConfig(repoRoot, config);
  pass(".continuum/config.json", "written");

  // Initialise database
  const dbPath = getDbPath(repoRoot);
  const db = openDatabase(dbPath);
  migrate(db);
  db.close();
  pass(".continuum/continuum.db", "database initialised");

  // Offer to update .gitignore
  blank();
  if (!nonInteractive) {
    const addToGitignore = await promptYesNo(
      "Add .continuum/ to .gitignore?",
      true,
    );
    if (addToGitignore) {
      await appendToGitignore(repoRoot);
    }
  } else {
    await appendToGitignore(repoRoot);
  }

  blank();
  section("Configuration summary");
  kv("Default agent", config.defaultAgent);
  kv("Test commands", config.testCommands.join(", ") || "(none)");
  kv("Capture raw output", String(config.captureRawOutput));
  kv("Database", getDbPath(repoRoot));

  blank();
  pass("Continuum initialised successfully.");
  blank();
  line(dim('Run your first task with: continuum run "Fix the failing test"'));
  blank();
}
