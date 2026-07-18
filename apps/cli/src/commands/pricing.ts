import { basename } from "node:path";
import {
  migrate,
  openDatabase,
  PricingProfileRepository,
  RepositoryRepository,
} from "@continuum/database";
import type { ModelPricingProfile } from "@continuum/shared";
import { getRepositoryRoot, isGitRepository } from "@continuum/git-analyzer";
import { getDbPath, isInitialised } from "../config-helpers.js";
import { blank, info, line, printError, section } from "../display.js";

export interface PricingCommandOptions {
  cwd: string;
  provider?: string;
  input?: string;
  cachedInput?: string;
  output?: string;
  version?: string;
  effectiveFrom?: string;
}

async function openRepositoryDatabase(cwd: string) {
  if (!(await isGitRepository(cwd))) {
    throw new Error("Pricing requires a Git repository initialized by Continuum.");
  }
  const repoRoot = await getRepositoryRoot(cwd);
  if (!(await isInitialised(repoRoot))) {
    throw new Error("Continuum is not initialised. Run 'continuum init' first.");
  }
  const db = openDatabase(getDbPath(repoRoot));
  migrate(db);
  new RepositoryRepository(db).upsert(repoRoot, basename(repoRoot));
  return db;
}

function parseOptionalRate(
  label: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
  return parsed;
}

export async function runPricingShowCommand(
  model: string | undefined,
  options: PricingCommandOptions,
): Promise<void> {
  const db = await openRepositoryDatabase(options.cwd);
  try {
    const repository = new PricingProfileRepository(db);
    const profiles = model
      ? [repository.findLatest(model, options.provider)].filter(
          (profile): profile is NonNullable<typeof profile> =>
            profile !== undefined,
        )
      : repository.list();

    section("Pricing profiles");
    if (profiles.length === 0) {
      info("No pricing profiles configured.");
      line("  Cost evidence will remain unavailable until a matching model profile is set.");
      return;
    }

    for (const profile of profiles) {
      line(`  ${profile.provider}/${profile.model}${profile.version ? `@${profile.version}` : ""}`);
      line(`    effective: ${profile.effectiveFrom}`);
      line(`    source: ${profile.source}`);
      line(
        `    input: ${profile.inputCreditsPerMillionTokens ?? "unavailable"} credits / 1M tokens`,
      );
      line(
        `    cached input: ${profile.cachedInputCreditsPerMillionTokens ?? "unavailable"} credits / 1M tokens`,
      );
      line(
        `    output: ${profile.outputCreditsPerMillionTokens ?? "unavailable"} credits / 1M tokens`,
      );
      blank();
    }
  } finally {
    db.close();
  }
}

export async function runPricingSetCommand(
  model: string,
  options: PricingCommandOptions,
): Promise<void> {
  const provider = options.provider?.trim();
  if (!provider) {
    throw new Error("--provider is required.");
  }

  const profile: ModelPricingProfile = {
    provider,
    model,
    version: options.version,
    inputCreditsPerMillionTokens: parseOptionalRate("--input", options.input),
    cachedInputCreditsPerMillionTokens: parseOptionalRate(
      "--cached-input",
      options.cachedInput,
    ),
    outputCreditsPerMillionTokens: parseOptionalRate("--output", options.output),
    source: "user_configured",
    effectiveFrom: options.effectiveFrom,
  };

  if (
    profile.inputCreditsPerMillionTokens === undefined &&
    profile.cachedInputCreditsPerMillionTokens === undefined &&
    profile.outputCreditsPerMillionTokens === undefined
  ) {
    throw new Error("At least one pricing rate must be supplied.");
  }

  const db = await openRepositoryDatabase(options.cwd);
  try {
    const stored = new PricingProfileRepository(db).set(profile);
    info(
      "Pricing profile recorded",
      `${stored.provider}/${stored.model} effective ${stored.effectiveFrom}`,
    );
    line("  This append-only profile will be used only for matching future cost calculations.");
  } finally {
    db.close();
  }
}
