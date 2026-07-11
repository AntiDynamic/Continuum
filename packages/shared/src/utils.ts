import { randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";

/**
 * Cross-platform path utilities.
 * All functions return POSIX-style forward-slash paths internally but
 * accept both Windows and POSIX inputs.
 */

/** Normalise to forward slashes — safe to store in the database. */
export function normalisePath(p: string): string {
  return p.split(sep).join("/");
}

/** Resolve a path relative to cwd with forward slashes. */
export function resolveNormalised(...parts: string[]): string {
  return normalisePath(resolve(join(...parts)));
}

/** Generate a collision-resistant run identifier. */
export function generateRunId(): string {
  return randomUUID();
}

/** Generate a collision-resistant event identifier. */
export function generateEventId(): string {
  return randomUUID();
}

/** Return the current ISO-8601 timestamp. */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Parse a duration string (e.g. "5m", "30s", "2m30s", "90000") into
 * milliseconds.  Returns the number directly if it is already numeric.
 */
export function parseDurationMs(input: string): number {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  let total = 0;
  const parts = trimmed.matchAll(/(\d+(?:\.\d+)?)\s*([hmsd]?)/gi);
  for (const [, value, unit] of parts) {
    const n = parseFloat(value ?? "0");
    switch ((unit ?? "").toLowerCase()) {
      case "h":
        total += n * 3_600_000;
        break;
      case "m":
        total += n * 60_000;
        break;
      case "s":
        total += n * 1_000;
        break;
      default:
        total += n;
    }
  }
  return Math.round(total);
}

/** Format milliseconds as a human-readable duration string. */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const s = Math.floor(ms / 1_000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/** Truncate a string to maxLen with ellipsis when needed. */
export function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}
