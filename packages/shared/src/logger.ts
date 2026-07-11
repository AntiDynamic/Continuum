/**
 * Structured logger for Continuum internals.
 *
 * Outputs machine-readable JSON lines when CONTINUUM_LOG_JSON=1, or
 * concise human-readable lines otherwise.  User-facing CLI output is
 * handled separately by each command and is not routed through this logger.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function resolveMinLevel(): LogLevel {
  const env = process.env["CONTINUUM_LOG_LEVEL"];
  if (env && env in LEVELS) {
    return env as LogLevel;
  }
  return process.env["CONTINUUM_DEBUG"] === "1" ? "debug" : "info";
}

const JSON_MODE = process.env["CONTINUUM_LOG_JSON"] === "1";

function formatHuman(
  level: LogLevel,
  component: string,
  message: string,
  extra?: Record<string, unknown>,
): string {
  const time = new Date().toISOString();
  const prefix = `[${time}] [${level.toUpperCase()}] [${component}]`;
  const suffix = extra ? " " + JSON.stringify(extra) : "";
  return `${prefix} ${message}${suffix}`;
}

function write(
  level: LogLevel,
  component: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  const minLevel = resolveMinLevel();
  if (LEVELS[level] < LEVELS[minLevel]) return;

  const line = JSON_MODE
    ? JSON.stringify({
        time: new Date().toISOString(),
        level,
        component,
        message,
        ...extra,
      })
    : formatHuman(level, component, message, extra);

  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

/** Create a scoped logger for a specific component. */
export function createLogger(component: string) {
  return {
    debug: (message: string, extra?: Record<string, unknown>) =>
      write("debug", component, message, extra),
    info: (message: string, extra?: Record<string, unknown>) =>
      write("info", component, message, extra),
    warn: (message: string, extra?: Record<string, unknown>) =>
      write("warn", component, message, extra),
    error: (message: string, extra?: Record<string, unknown>) =>
      write("error", component, message, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
