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

export interface RedactionResult {
  value: unknown;
  redactionApplied: boolean;
}

/**
 * Recursively redact all string values inside a JSON-compatible object.
 * Preserves the structural shape so the caller can still access other fields.
 */
export function redactValue(
  value: unknown,
  extraPatterns: string[] = [],
  visited = new WeakSet(),
): RedactionResult {
  if (typeof value === "string") {
    const redacted = redactString(value, extraPatterns);
    return { value: redacted, redactionApplied: redacted !== value };
  }
  
  if (value === null || typeof value !== "object") {
    return { value, redactionApplied: false };
  }

  // Prevent circular references
  if (visited.has(value)) {
    return { value: "[CIRCULAR]", redactionApplied: true };
  }
  visited.add(value);

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    let applied = false;
    for (const item of value) {
      const res = redactValue(item, extraPatterns, visited);
      result.push(res.value);
      if (res.redactionApplied) applied = true;
    }
    return { value: result, redactionApplied: applied };
  }

  // Handle plain objects
  if (Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, unknown> = {};
    let applied = false;
    for (const [k, v] of Object.entries(value)) {
      const res = redactValue(v, extraPatterns, visited);
      result[k] = res.value;
      if (res.redactionApplied) applied = true;
    }
    return { value: result, redactionApplied: applied };
  }

  // For non-plain objects, we do not mutate or recurse safely, just return a string representation redacted
  const str = String(value);
  const redacted = redactString(str, extraPatterns);
  return { value: redacted, redactionApplied: true }; // Consider it applied since it's a non-plain object cast to string
}

export interface RedactedCommand {
  displayCommand: string;
  executable: string;
  args: string[];
  redactionApplied: boolean;
}

/**
 * Redact arguments safely.
 * Matches formats like `--flag=value`, `--flag value`, or standalone secrets.
 */
export function redactCommand(
  executable: string,
  args: string[],
  customPatterns: string[] = [],
): RedactedCommand {
  const redactedArgs: string[] = [];
  let redactionApplied = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    
    // Test if this argument itself contains a secret (e.g., --key=secret or ENV=secret)
    const selfRedacted = redactString(arg, customPatterns);
    if (selfRedacted !== arg) {
      redactedArgs.push(selfRedacted);
      redactionApplied = true;
      continue;
    }

    // Check if it's a flag that takes a subsequent secret argument
    const isSecretFlag = /^(?:--|-)?[A-Za-z0-9_]*(?:key|token|password|secret|auth)[A-Za-z0-9_]*$/i.test(arg);
    const isAuthorizationHeader = /^Authorization:\s*$/i.test(arg); // If split by spaces
    
    redactedArgs.push(arg);
    
    if (isSecretFlag || isAuthorizationHeader) {
      // The NEXT argument might be the secret value
      if (i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
        i++;
        redactedArgs.push("[REDACTED:FLAG_VALUE]");
        redactionApplied = true;
      }
    }
  }

  const displayArgs = redactedArgs.map(a => (/\s/.test(a) ? JSON.stringify(a) : a));
  const displayCommand = `${executable} ${displayArgs.join(" ")}`.trim();

  return {
    displayCommand,
    executable,
    args: redactedArgs,
    redactionApplied,
  };
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
    const parsed = JSON.parse(input);
    const result = redactValue(parsed, extraPatterns);
    return JSON.stringify(result.value);
  } catch {
    return redactString(input, extraPatterns);
  }
}
