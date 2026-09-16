# Phase 5 Implementation Plan: Context Delivery and Compaction Optimization

## Objective

Reduce total input/context cost while preserving the files, symbols, contracts,
tests, decisions, and failure history required for a correct verified task.

## Task list

- [x] P5-01 Define durable recovery state and recovery-packet contract.
  - Acceptance: a session can be reopened after restart/compaction and produce a
    compact packet containing task, progress, active context IDs, constraints,
    blockers, validation state, and next action.
- [x] P5-02 Persist explicit context-item identity and snapshot-bound delivery
  receipts.
  - Acceptance: every delivery records new, restored, referenced, omitted, and
    repeated items with stable hashes and repository ownership.
- [x] P5-03 Add separate context plan, get, delta, recover, and receipt APIs.
  - Acceptance: CLI and MCP expose small, composable operations without
    returning unchanged full content. `session plan` and
    `continuum_plan_context_session` now provide metadata-only planning;
    `context`/`get_initial_context`, `request`, `recover`, and `report` remain
    separate retrieval, recovery, and receipt operations.
- [x] P5-04 Add context utility measurements.
  - Acceptance: reports distinguish retrieved, delivered, referenced, repeated,
    omitted, and actually-used context. Reports now expose these counters under
    `context.utility`; actual usage remains `null` until provider/agent evidence
    is available.
- [x] P5-05 Add provider-neutral usage and cost evidence.
  - Acceptance: reports separate input, cached input, output, reasoning,
    compaction, estimated context, and total cost. Context-session reports now
    include the existing provider usage and derived-cost evidence when a run is
    linked; unavailable values remain explicitly unavailable.
- [ ] P5-06 Add GPT-5.6 Codex baseline and assisted-mode experiments.
  - Acceptance: identical tasks can compare normal, planned, progressive, and
    recovery-assisted execution.
- [ ] P5-07 Add cache-aware packing and adaptive budgets.
  - Acceptance: stable prefixes remain cacheable and budgets vary by task risk
    without dropping required context silently.
- [ ] P5-08 Run cross-agent evaluation.
  - Acceptance: Codex, Gemini, Claude, Qwen, and at least one MCP-capable IDE
    are compared using the same task corpus and cost-per-verified-task metric.

## Working rules

- Preserve the passing build, lint, typecheck, and test baseline.
- Do not claim provider savings from estimated packet tokens.
- Never silently omit required context; report the missing category and budget.
- Bind every delivered item to a repository and indexed snapshot.
- Prefer reversible schema additions and append-only evidence.
- Measure task success and rework together with token reduction.

## Execution order

P5-01 → P5-02 → P5-03 → P5-04 → P5-05 → P5-06 → P5-07 → P5-08
