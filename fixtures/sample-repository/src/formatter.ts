/**
 * formatter.ts
 *
 * Text formatting utilities.  Completely unrelated to the calculator module.
 *
 * Continuum uses this module to verify that the agent did not modify
 * unrelated code while fixing the calculator bug.
 */

/** Pad a string on the left to the given width. */
export function padLeft(text: string, width: number, fill = " "): string {
  const needed = width - text.length;
  if (needed <= 0) return text;
  return fill.repeat(needed) + text;
}

/** Pad a string on the right to the given width. */
export function padRight(text: string, width: number, fill = " "): string {
  const needed = width - text.length;
  if (needed <= 0) return text;
  return text + fill.repeat(needed);
}

/** Truncate a string and append an ellipsis when it exceeds maxLength. */
export function ellipsis(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

/** Convert a camelCase identifier to kebab-case. */
export function camelToKebab(text: string): string {
  return text
    .replace(/([A-Z])/g, (match) => `-${match.toLowerCase()}`)
    .replace(/^-/, "");
}

/** Capitalise the first character of a string. */
export function capitalise(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
