/**
 * Typed error hierarchy for Continuum.
 *
 * Using specific error classes instead of plain Error objects means callers
 * can use instanceof checks and get typed properties without parsing messages.
 */

/** Base class for all Continuum errors. */
export class ContinuumError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ContinuumError";
    // Restore correct prototype chain for instanceof checks.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Configuration file is missing, malformed, or fails schema validation. */
export class ConfigError extends ContinuumError {
  constructor(message: string, cause?: unknown) {
    super(message, "CONFIG_ERROR", cause);
    this.name = "ConfigError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Agent adapter could not be found or initialised. */
export class AgentNotFoundError extends ContinuumError {
  constructor(agentId: string, cause?: unknown) {
    super(
      `Agent "${agentId}" is not available. Run "continuum doctor" for diagnostics.`,
      "AGENT_NOT_FOUND",
      cause,
    );
    this.name = "AgentNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** An agent run failed in a way the adapter could not recover from. */
export class AgentRunError extends ContinuumError {
  constructor(
    message: string,
    public readonly runId: string,
    cause?: unknown,
  ) {
    super(message, "AGENT_RUN_ERROR", cause);
    this.name = "AgentRunError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A git command failed or the path is not inside a git repository. */
export class GitError extends ContinuumError {
  constructor(message: string, cause?: unknown) {
    super(message, "GIT_ERROR", cause);
    this.name = "GitError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The current directory is not inside a git repository. */
export class NotARepositoryError extends GitError {
  constructor(path: string) {
    super(`"${path}" is not inside a git repository.`);
    this.name = "NotARepositoryError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A database operation failed. */
export class DatabaseError extends ContinuumError {
  constructor(message: string, cause?: unknown) {
    super(message, "DATABASE_ERROR", cause);
    this.name = "DatabaseError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The requested run does not exist. */
export class RunNotFoundError extends ContinuumError {
  constructor(runId: string) {
    super(`Run "${runId}" was not found in the database.`, "RUN_NOT_FOUND");
    this.name = "RunNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A test command timed out. */
export class TestTimeoutError extends ContinuumError {
  constructor(command: string, timeoutMs: number) {
    super(
      `Test command "${command}" timed out after ${timeoutMs}ms.`,
      "TEST_TIMEOUT",
    );
    this.name = "TestTimeoutError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Continuum has not been initialised in this repository. */
export class NotInitialisedError extends ContinuumError {
  constructor(path: string) {
    super(
      `Continuum is not initialised in "${path}". Run "continuum init" first.`,
      "NOT_INITIALISED",
    );
    this.name = "NotInitialisedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
