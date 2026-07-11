/**
 * Configuration helpers — read and write .continuum/config.json.
 */

import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ContinuumConfigSchema, ConfigError, DEFAULT_CONFIG } from "@continuum/shared";
import type { ContinuumConfig } from "@continuum/shared";

export const CONTINUUM_DIR = ".continuum";
export const CONFIG_FILE = "config.json";
export const DB_FILE = "continuum.db";
export const RUNS_DIR = "runs";

export function getContinuumDir(repoRoot: string): string {
  return join(repoRoot, CONTINUUM_DIR);
}

export function getConfigPath(repoRoot: string): string {
  return join(repoRoot, CONTINUUM_DIR, CONFIG_FILE);
}

export function getDbPath(repoRoot: string): string {
  return join(repoRoot, CONTINUUM_DIR, DB_FILE);
}

export function getRunsDir(repoRoot: string): string {
  return join(repoRoot, CONTINUUM_DIR, RUNS_DIR);
}

export async function isInitialised(repoRoot: string): Promise<boolean> {
  try {
    await access(getConfigPath(repoRoot));
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(repoRoot: string): Promise<ContinuumConfig> {
  const configPath = getConfigPath(repoRoot);
  try {
    const raw = await readFile(configPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (jsonErr) {
      throw new ConfigError(
        `Configuration file is not valid JSON: ${configPath}`,
        jsonErr,
      );
    }

    const result = ContinuumConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigError(
        `Configuration file failed validation: ${result.error.message}`,
      );
    }
    return result.data;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(
      `Cannot read configuration from ${configPath}. Run "continuum init" first.`,
      err,
    );
  }
}

export async function saveConfig(
  repoRoot: string,
  config: ContinuumConfig,
): Promise<void> {
  const dir = getContinuumDir(repoRoot);
  await mkdir(dir, { recursive: true });
  const configPath = getConfigPath(repoRoot);
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export async function ensureRunsDir(repoRoot: string): Promise<void> {
  await mkdir(getRunsDir(repoRoot), { recursive: true });
}

/** Detect common test commands from repository contents. */
export async function detectTestCommands(repoRoot: string): Promise<string[]> {
  const commands: string[] = [];
  try {
    const pkgJson = JSON.parse(
      await readFile(join(repoRoot, "package.json"), "utf-8"),
    ) as { scripts?: Record<string, string> };
    const scripts = pkgJson.scripts ?? {};
    if (scripts["test"]) commands.push("pnpm test");
    else if (scripts["vitest"]) commands.push("pnpm vitest run");
  } catch {
    // No package.json — try other indicators
  }

  // Python/pytest
  try {
    await access(join(repoRoot, "pytest.ini"));
    commands.push("python -m pytest");
  } catch {
    // not pytest
  }

  return commands;
}

export { DEFAULT_CONFIG };
