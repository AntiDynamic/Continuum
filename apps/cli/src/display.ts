/**
 * Terminal output helpers.
 *
 * Provides consistent, readable CLI output with colour support.
 * Does not use an external colour library — just ANSI escape codes.
 */

const NO_COLOR = process.env["NO_COLOR"] !== undefined;
const IS_TTY = process.stdout.isTTY === true;

function ansi(code: string, text: string): string {
  if (NO_COLOR || !IS_TTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export const bold = (t: string) => ansi("1", t);
export const dim = (t: string) => ansi("2", t);
export const green = (t: string) => ansi("32", t);
export const yellow = (t: string) => ansi("33", t);
export const red = (t: string) => ansi("31", t);
export const cyan = (t: string) => ansi("36", t);
export const blue = (t: string) => ansi("34", t);
export const magenta = (t: string) => ansi("35", t);

export function line(text = ""): void {
  process.stdout.write(text + "\n");
}

export function blank(): void {
  process.stdout.write("\n");
}

export function section(title: string): void {
  blank();
  line(bold(title));
  line("─".repeat(Math.min(title.length, 60)));
}

export function pass(label: string, detail?: string): void {
  const marker = green("PASS");
  line(`  ${marker}  ${label}${detail ? dim(` — ${detail}`) : ""}`);
}

export function fail(label: string, detail?: string): void {
  const marker = red("FAIL");
  line(`  ${marker}  ${label}${detail ? dim(` — ${detail}`) : ""}`);
}

export function warn(label: string, detail?: string): void {
  const marker = yellow("WARN");
  line(`  ${marker}  ${label}${detail ? dim(` — ${detail}`) : ""}`);
}

export function info(label: string, detail?: string): void {
  const marker = cyan("INFO");
  line(`  ${marker}  ${label}${detail ? dim(` — ${detail}`) : ""}`);
}

export function kv(
  key: string,
  value: string,
  quality?: string,
): void {
  const paddedKey = key.padEnd(30);
  const qualityLabel =
    quality && quality !== "exact"
      ? dim(` [${quality}]`)
      : "";
  line(`  ${dim(paddedKey)}  ${value}${qualityLabel}`);
}

export function unavailable(key: string): void {
  const paddedKey = key.padEnd(30);
  line(`  ${dim(paddedKey)}  ${dim("unavailable")}`);
}

export function printError(message: string): void {
  process.stderr.write(red("Error: ") + message + "\n");
}

export function printWarning(message: string): void {
  process.stderr.write(yellow("Warning: ") + message + "\n");
}
