import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CapturePolicy { captureRawOutput?: boolean; redactPatterns?: string[] }

export function capturePolicyFor(repositoryRoot: string): CapturePolicy {
  try {
    const config = JSON.parse(readFileSync(join(repositoryRoot, ".continuum", "config.json"), "utf8"));
    return { captureRawOutput: config.captureRawOutput !== false, redactPatterns: Array.isArray(config.redactPatterns) ? config.redactPatterns.filter((value: unknown) => typeof value === "string") : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
