# Continuum Observer Limitations

While Continuum aims to provide comprehensive observability for AI coding agents, the V1 architecture has several known limitations.

## 1. Adapter Support

Currently, Continuum V1 only supports the **Google Gemini CLI (`gemini`)**.

Future versions intend to add support for other agents (e.g., Claude Code, Antigravity, Aider) via the `AgentAdapter` interface, provided those tools offer structured telemetry output modes.

## 2. Telemetry Fidelity

Continuum relies on the agent emitting structured, detailed JSON logs. If the agent does not emit an event for a specific action (e.g., a file read that isn't logged, or a tool call that is silently executed), Continuum cannot observe it.

- **Tokens**: Token counts are entirely dependent on the agent emitting `usage` events. If the agent does not report token usage, Continuum cannot track costs.
- **Internal Chain-of-Thought**: The internal reasoning or "scratchpad" thoughts of the language model are often not exposed by the agent CLI to the user, and therefore cannot be captured by Continuum.

## 3. Git Attribution in Dirty Worktrees

If a developer runs Continuum in a repository with uncommitted changes (a "dirty" working tree), and the agent modifies files that were *already* modified by the developer, Continuum will mark the attribution confidence as `LOW`.

Continuum cannot definitively separate the developer's pre-existing uncommitted diff from the agent's new diff within the same file without committing the developer's changes first. It is strongly recommended to run agents in a clean working tree.

## 4. Test Orchestration

- Continuum assumes a single, synchronous test command defined in `continuum.yaml`.
- It currently only extracts exit codes (0 = pass, non-zero = fail). It does not parse TAP output, JUnit XML, or specific test runner stdout to determine exactly *which* tests failed.
- If the test suite is non-deterministic (flaky), Continuum may incorrectly attribute a broken test to the agent's actions.

## 5. Security Redaction

While Continuum implements a robust regex-based redaction engine for API keys and secrets, it is a heuristic system.

- It may occasionally produce **false positives**, redacting strings that happen to look like API keys (e.g., long hashes or base64 strings).
- It cannot guarantee 100% removal of novel or unrecognized secret formats without explicit custom regex definitions in `continuum.yaml`.

## 6. Concurrent Runs

Continuum V1 is designed for single-developer, sequential use within a local repository. Running multiple Continuum instances concurrently on the same repository database (`.continuum/continuum.db`) may result in SQLite lock contention (`SQLITE_BUSY`) or interwoven git snapshots.
