# Continuum Observer Limitations

While Continuum aims to provide comprehensive observability for AI coding agents, the V1 architecture has several known limitations.

## 1. Adapter Support

Currently, Continuum V1 only supports the **Google Gemini CLI (`gemini`)**.

Future versions intend to add support for other agents (e.g., Claude Code, Antigravity, Aider) via the `AgentAdapter` interface, provided those tools offer structured telemetry output modes.

## 2. Telemetry Fidelity

Continuum relies on the agent emitting structured, detailed JSON logs. If the agent does not emit an event for a specific action (e.g., a file read that isn't logged, or a tool call that is silently executed), Continuum cannot observe it.

- **Tokens and cost**: Provider usage requires an adapter-emitted usage event.
  Costs are only derived when a matching user-configured pricing profile exists;
  otherwise cost evidence is explicitly unavailable. Context packet tokens are
  conservative estimates and are not provider billing counts.
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

## 7. Context-Efficiency Claims

Continuum records what context it supplied and can suppress exact duplicate
content or a whole file after a symbol from that file is already active in the
run ledger. It does not yet observe every independent context channel used by an
agent, and it has no counterfactual baseline for what the agent would otherwise
have received.

Potential duplicate context avoided is therefore a ledgered decision, not proof
of end-to-end token savings.

## Progressive context sessions

Continuum does not yet prove causal task improvement. Provider-exact token telemetry is not connected to sessions. Estimated duplicate context avoided is not exact credit savings, and the progressive policy is not claimed to be optimal. Sessions require an exact match with the locally indexed repository snapshot.

## Deterministic retrieval benchmark

Phase 3D measured controlled Recall@10 at 94.17% and mandatory coverage recall at 98.61%. Real-repository medians are 1,847 estimated tokens and 152.797 ms local retrieval latency for Continuum, and 766 tokens and 113.748 ms for aurum-dining. Continuum real Recall@5 declined while Recall@10 remained 80%; exact lookup and database hydration remain the dominant measured costs. Stage-level baseline timings were unavailable before Phase 3D instrumentation. These results do not measure provider tokens, end-to-end task latency, coding-task success, or provider savings.

## Codex shadow integration

Phase 4A observes Codex App Server evidence; it does not constrain Codex, inject Continuum’s predicted packet, prove task success from telemetry alone, or prove provider token/cost savings. Direct App Server item and diff events are stronger evidence than command-inferred paths. Stable accumulated usage is provider measured when emitted; absent fields remain unavailable. Experimental raw-response telemetry is opt-in, separately labelled, and may not be available or replayable. Concurrent external repository edits can still make attribution uncertain.
