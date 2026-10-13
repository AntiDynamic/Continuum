# Continuum Project Context

Updated: 2026-10-12

## Current phase: autonomous recovery

The [phase-next implementation](phase-next/implementation.md) adds original
evidence and versioned task memory to the existing SQLite database (migration
14), bounded recovery, explicit requirement supersession, and persistent Codex
thread bindings. Continuation injects current recovery before a new turn.
Modern compaction item events are recognized, but immediate injection inside
an ongoing turn is not claimed. Offline A/B/C setup and independent validators
are implemented; paid model-driven runs remain unexecuted. Provider usage,
cost savings, real compaction recovery, and general performance are unproven.

## Repository audit and current release blockers

Implementation update: the [audit follow-up](audit/implementation-2026-10-12.md)
records repaired behavioral verification, delivery budgets, evolving sessions,
receipts, redaction, usage accounting, and comparison initialization. Build,
typecheck, lint, 226 workspace tests, and 10 script regressions pass; four
provider tests are skipped. Four controlled retrieval cases still miss required
context. Live effectiveness, cache hits, and cost savings remain unqualified.
The paragraphs below record the earlier audit baseline.

The [2026-10-12 repository audit](repository-audit-2026-10-12.md) supersedes
earlier confidence statements where the audit demonstrates a missing gate.
Dead legacy implementations, duplicate generated tests, placeholder regression
assertions, and unused dependencies were removed. Build, typecheck, lint, and
the offline workspace suite pass: 226 tests passed, four live-provider tests
skipped explicitly or by their existing opt-in policy.

Offline [reproductions](audit/reproduce.mjs) and
[results](audit/results-2026-10-12.json) confirm that the benchmark's visible
and hidden regex checks can accept an incorrect implementation; empty retrieved
coverage can be marked complete; a handoff can exceed or bypass the session
budget; requests after normal code edits fail; omission details disappear on
delivery reconstruction; `codex compare` lacks worktree initialization; raw
Codex persistence bypasses redaction; and Git dirty-path parsing can mislabel
attribution. The experiment report also omits its default pure-preflight
comparison. These functional defects remain open after cleanup.

Historical provider usage is diagnostic evidence. Historical Phase 6
`verifiedTaskSuccess` labels require qualification with executable behavioral
tests before supporting effectiveness conclusions. The immediate priority is
the audit's offline truth gate, followed by a refreshable edit/test/context
loop, then one controlled responsive provider path. No new provider benchmark
was run during this audit.

## Purpose

Continuum is a vendor-neutral context delivery and observability system for
coding agents. The current product goal is to reduce provider input tokens and
cost while preserving verified task success, correct scope, and recovery after
context compaction.

## Current implementation

- Repository indexing and snapshot-bound context items.
- Task analysis, coverage requirements, deterministic retrieval, and context
  packets.
- Progressive context sessions with initial delivery, targeted escalation,
  duplicate suppression, signal handling, recovery, and persisted receipts.
- CLI and MCP interfaces for session lifecycle and context delivery.
- Provider usage/cost evidence when the adapter exposes it; estimated packet
  tokens are kept separate from measured provider usage.
- Phase 0 usage measurement contract: provider-reported totals and
  cache-creation tokens, versioned cache-write pricing, append-only per-event
  usage snapshots, and source-event linkage for run-level evidence.
- Phase 6 isolated Antigravity/Gemini runner with fresh repositories, MCP
  registry snapshot/restore, visible and hidden verification, and paired
  reporting.
- Phase 6 OpenCode runner support with model-qualified runs, JSON-event parsing,
  project-scoped MCP configuration, and the same validation/evidence schema.
- Adaptive first-delivery profiles and a prompt-ready preflight handoff.
- Phase 1 cache-ready packet layers: a deterministic, snapshot-bound stable
  repository prefix and task-specific delta with SHA-256 content hashes,
  provenance, item IDs, coverage state, and a lightweight delivery manifest.
- Phase 2 delivery receipts: cache-layer payloads survive session-process
  restarts, MCP compact responses preserve the stable prefix, adapters can
  declare delivery/cache telemetry capabilities, and Phase 6 artifacts record
  delivery mode and cache observations separately from provider usage.
- Preflight MCP now has a minimal targeted tool surface
  (`continuum_request_context`) so the first request does not pay for the full
  interactive session schema; regular MCP keeps the complete lifecycle
  surface.
- The benchmark runner now supports `continuum_preflight_only`, which injects
  the same handoff without MCP for causal isolation of prompt versus tool
  schema cost.
- New pilot runs default to `continuum_off` versus
  `continuum_preflight_only`; targeted MCP is now an explicit diagnostic arm,
  so the default comparison measures context delivery without MCP schema
  overhead.
- Phase 6 results now separate `patchValidated`,
  `agentFinishedWithinTimeout`, `providerTimeout`, and
  `verifiedTaskSuccess`. A provider timeout can therefore preserve useful
  patch evidence without being misreported as a completed success.
- The first responsive low-cost Antigravity gate measured a 29.6% lower total
  token count with preflight, but the preflight agent timed out and failed the
  visible task validator. This is diagnostic evidence only, not a product
  result.
- Follow-up diagnostics found and fixed two cost/correctness hazards: unused
  MCP lifecycle schemas are removed from preflight, and retrieval now follows
  one bounded relationship hop to retain edit-critical sibling dependencies.
  The next paired run confirmed the dependency in the handoff, but the low
  model still timed out under the two-minute cap.

## Latest change

Commit `f307d6d` (`feat: add adaptive preflight context delivery`) added:

- task-aware first delivery budgets: lean 1,000; standard 1,250; complex
  1,450; critical 1,500 estimated tokens;
- `continuum session handoff <session-id> --json`;
- the `continuum_preflight` Phase 6 treatment, which injects context before the
  first model turn and reserves MCP for targeted deltas;
- preflight-vs-baseline reporting support.

The current working tree also contains the Phase 0 measurement slice described
above. It is validated by package tests but is not yet a provider effectiveness
result.

## What is proven

- Full build and lint pass.
- Context-engine session tests pass.
- CLI standalone acceptance passes.
- MCP session product tests pass.
- Recovery smoke passes.
- The product lifecycle and evidence persistence work end to end.
- The compiler now produces byte-stable cache layers for a fixed repository
  snapshot; this is an implementation guarantee, not yet provider cache or
  dollar-savings evidence.
- Initial context can be reconstructed with its stable-prefix payload and
  task-delta manifest after a fresh process; this is tested persistence, not a
  provider cache hit.
- Targeted preflight MCP exposes only the delta-request tool, and bounded
  relationship expansion is covered by regression tests.
- Antigravity can emit provider usage and cache-read telemetry through the
  current stream-json path, and the runner can persist a delivery receipt.
  The one paired gate did not establish that Continuum caused the cache reads.

## What is not proven

- A provider-cost reduction from Continuum.
- A provider cache discount from the preflight packet.
- A statistically reliable improvement in verified task success.
- Cross-agent results across Codex, Gemini, Claude, Qwen, or IDE agents.

The existing Gemini pilot was quota-censored before it could support a valid
effectiveness conclusion. Do not present the preliminary smoke files as a
final product result.

## Main known gaps

1. The ordinary MCP treatment still depends on the model voluntarily requesting
   context after the first turn.
2. `actuallyUsedItemCount` is not yet connected to agent file/tool evidence.
3. Provider cache-read telemetry is not consistently available through the
   Antigravity path.
4. Provider-native cache handles, cache-read telemetry, and cache-aware
   packing remain incomplete; the current stable prefix is only a deterministic
   delivery layer.
5. OpenCode is installed locally (`1.18.31`) and OpenCode Zen is now connected.
   The benchmark is restricted to the locally exposed free model IDs; the
   first pre-auth smoke timed out without model telemetry.
6. The preflight handoff can reduce provider usage on a low model, but the
   current one-pair result exposed a correctness/timeout risk. Preflight must
   be qualified for task success before any savings claim.
7. The first preflight pair mixed prompt delivery with the full MCP tool
   schema. The targeted-surface fix is implemented but its provider-token
   effect is not yet measured.
8. The low Antigravity model has not completed the preflight task reliably
   under the two-minute benchmark cap, even after the context-completeness fix.
   A longer-cap paired qualification is required; it must be priced and still
   meet verified-success criteria.
9. The same low model reached the five-minute cap on the baseline arm. It is
   currently unsuitable for decision-grade qualification; the next live test
   needs a responsive model/API path with a matching pricing profile.
10. The direct `gemini-3.5-flash-lite` smoke reaches Gemini but the configured
    project's request is rejected with HTTP 403 (`provider_project_access`).
    No direct API benchmark can start until the key's Google project is granted
    Gemini API access.

## Working rule for future changes

Every substantial implementation or experiment should update the relevant
Markdown log, record the commit and validation evidence, and distinguish
estimated context savings from measured provider tokens and dollars.

## 2026-10-13 recovery evidence update

Three configured assist delivery modes now share existing retrieval: initial_packet
(default), minimal_manifest, on_demand. The third real smoke verifies native compaction,
exact same-thread recovery receipt and final fixture behavior. Provider-budget
qualification failed because app-server totals excluded compaction; a native-record
reconciliation repair is verified offline. Actual active occupancy, billing credits,
causal improvement and comparative savings remain unavailable/unverified. See
[the evidence report](phase-next/context-efficiency-2026-10-13/report.md).

## Current comparative phase (2026-10-13)

The third real smoke established same-thread native compaction recovery with
passing behavioral checks; native compaction also retained its critical requirement.
It does not establish superiority. Compaction-inclusive usage is 104,642 tokens.
The comparative phase preserves that baseline at `8bba103940eea6973e6fdcf2597cff58c6be2efc`
and prepares a frozen A/B/C/D warehouse pilot with independent behavioral evaluation.
The [pilot design](phase-next/comparative-pilot-2026-10-13/design.md) supersedes stale
status statements above about live recovery being unexecuted. Performance and actual
billing savings remain unqualified until controlled results support them.

Comparative pilot outcome: native/full/minimal/adaptive all pass 16 behavioral
checks. Total reported tokens are 139,654 / 185,645 / 255,744 / 176,185. Native has
lowest reported usage; full finishes fastest. No compaction occurs and adaptive
source hydration does not trigger. General correctness/cost advantages remain
unproven. The observed malformed retrieval wrapper is repaired offline after the
study; final validation combines 338 passing offline cases and four provider skips.
[Full report and study proposal](phase-next/comparative-pilot-2026-10-13/report.md).
