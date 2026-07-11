/**
 * Secret redaction utilities.
 *
 * Redaction is performed with conservative regex patterns before any raw
 * agent output is persisted.  This is a best-effort defence and CANNOT
 * guarantee that every secret is removed.  Document this limitation to users.
 *
 * Design rules:
 * - Preserve enough structure so parse errors can be diagnosed.
 * - Replace secret values with [REDACTED], not empty strings.
 * - Apply redaction to both raw strings and JSON-parsed structures.
 * - Never read .env files proactively.
 */

/** A single redaction pattern with a label for logging. */
interface RedactionPattern {
  label: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * Built-in patterns covering common secret formats.
 * Each pattern is tested with documented examples in the test suite.
 */
const BUILT_IN_PATTERNS: RedactionPattern[] = [
  // API key assignments in text or JSON
  {
    label: "gemini-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35,40}\b/g,
    replacement: "[REDACTED:GEMINI_KEY]",
  },
  {
    label: "openai-api-key",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED:OPENAI_KEY]",
  },
  {
    label: "anthropic-api-key",
    pattern: /\bsk-ant-[A-Za-z0-9-]{20,}\b/g,
    replacement: "[REDACTED:ANTHROPIC_KEY]",
  },
  {
    label: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36}\b/g,
    replacement: "[REDACTED:GITHUB_TOKEN]",
  },
  // Generic bearer tokens in Authorization headers
  {
    label: "bearer-token",
    pattern: /(Authorization:\s*Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: "$1[REDACTED:BEARER]",
  },
  // PASSWORD= / API_KEY= / SECRET= style assignments
  {
    label: "key-assignment",
    pattern:
      /((?:API_KEY|SECRET|PASSWORD|TOKEN|ACCESS_KEY|PRIVATE_KEY)\s*[:=]\s*)["']?[^\s"',;]{6,}["']?/gi,
    replacement: "$1[REDACTED]",
  },
  // PEM private keys
  {
    label: "pem-private-key",
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
    replacement: "[REDACTED:PRIVATE_KEY]",
  },
];

/**
 * Compile a user-supplied regex pattern string into a RedactionPattern.
 * Returns null and logs a warning when the pattern is invalid.
 */
function compileUserPattern(
  raw: string,
  index: number,
): RedactionPattern | null {
  try {
    return {
      label: `user-pattern-${index}`,
      pattern: new RegExp(raw, "g"),
      replacement: "[REDACTED:CUSTOM]",
    };
  } catch {
    // Invalid regex from config — do not crash, warn only.
    console.warn(
      `[continuum:redact] User redact pattern #${index} is not a valid regex and will be skipped: ${raw}`,
    );
    return null;
  }
}

/** Apply all patterns to a single string and return the redacted result. */
export function redactString(
  input: string,
  extraPatterns: string[] = [],
): string {
  const patterns: RedactionPattern[] = [
    ...BUILT_IN_PATTERNS,
    ...extraPatterns
      .map((p, i) => compileUserPattern(p, i))
      .filter((p): p is RedactionPattern => p !== null),
  ];

  let result = input;
  for (const { pattern, replacement } of patterns) {
    // Reset lastIndex because we re-use compiled patterns.
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Recursively redact all string values inside a JSON-compatible object.
 * Preserves the structural shape so the caller can still access other fields.
 */
export function redactObject(
  // Object from parsed JSON — explicit any is unavoidable for a recursive utility.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any,
  extraPatterns: string[] = [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (typeof input === "string") {
    return redactString(input, extraPatterns);
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactObject(item, extraPatterns));
  }
  if (input !== null && typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      result[key] = redactObject(value, extraPatterns);
    }
    return result;
  }
  return input;
}

/**
 * Attempt to parse a string as JSON, redact all string values, then
 * re-serialise.  Falls back to plain-string redaction if parsing fails.
 */
export function redactJsonString(
  input: string,
  extraPatterns: string[] = [],
): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const parsed = JSON.parse(input);
    return JSON.stringify(redactObject(parsed, extraPatterns));
  } catch {
    return redactString(input, extraPatterns);
  }
}
