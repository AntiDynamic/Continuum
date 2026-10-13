# Continuum Experiment Log

## 2026-10-12 — Recovery infrastructure and offline A/B/C preparation

Implemented durable evidence, task memory, checkpoints, and native-thread
bindings. Offline tests exercise real SQLite and fresh CLI processes. Prepared
18 dry-run cells across six development cases and a three-arm simulated
compaction protocol demonstration; unfixed tasks remain failed. Added
filesystem isolation probes and guards against mismatched comparison cells,
mock success evidence, unknown cost conversion, and paid execution without
explicit approval. No real agent benchmark or real compaction was executed.
Exact validation counts and evidence are in the
[phase-next report](phase-next/implementation.md).

## 2026-10-12 — Offline validation after audit implementation

The [implementation record](audit/implementation-2026-10-12.md) links the new
reproductions and 24-case retrieval run. The forged patch now fails; budget,
refresh, coverage, redaction, lifecycle, comparison initialization, and usage
reproductions meet their intended checks. Retrieval still records four misses.
No live provider benchmark or cost-saving claim was made.

## 2026-10-12 — Dead-code cleanup and repository audit

Reviewed the active local worktree across CLI, all eleven packages, tests,
benchmark scripts/fixtures, CI, and documentation. Existing uncommitted changes
were preserved. Removed 53 obsolete/debug/generated files, including duplicate
test emissions and six placeholder Codex regression assertions, plus stale
compiled outputs and unused dependency declarations. Added a TypeScript-only
repository-indexer test include rule.

Validation:

- `pnpm build` — passed.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `CONTINUUM_DISABLE_CODEX_LIVE=1 pnpm test` — 226 passed, four skipped.
- `node --test scripts/phase6-outcome.test.mjs` — passed.
- `CONTINUUM_LOG_LEVEL=error node docs/audit/reproduce.mjs` — completed offline.

The [audit](repository-audit-2026-10-12.md) and
[reproduction results](audit/results-2026-10-12.json) record defects, including
incorrect-code acceptance by both benchmark validators, empty-context false
completeness, budget-bypassing handoffs, snapshot rejection after edits,
missing comparison initialization, omission receipt loss, raw-storage
redaction bypass, stranded ordinary runs, incorrect test counts, and incorrect
dirty-file attribution. Passing implementation tests does not qualify these
behaviors or the product's cost-saving hypothesis. Historical benchmark
success labels remain heuristic pending executable independent validation.

No provider API or live coding-agent benchmark was launched. No commit or
push was made; this entry describes an uncommitted local cleanup and audit.

## 2026-09-20 — Phase 0 measurement contract implementation

Change: added provider usage totals and cache-creation fields, versioned
cache-write pricing, append-only per-event usage snapshots, and source-event
linkage from run-level usage evidence. Reports now expose total/cache-creation
usage and source identifiers.

Validation:

- `pnpm --filter @continuum/shared build && pnpm --filter @continuum/shared test` — passed (47 tests).
- `pnpm --filter @continuum/gemini-adapter build && pnpm --filter @continuum/gemini-adapter test` — passed (22 tests, 3 skipped real-provider tests).
- `pnpm --filter @continuum/database build && pnpm --filter @continuum/database test` — passed (24 tests).
- `pnpm --filter @continuum/agent-core typecheck && pnpm --filter @continuum/agent-core test` — passed (7 tests).
- `pnpm --filter @continuum/evaluator typecheck && pnpm --filter @continuum/evaluator test` — passed (13 tests).
- `pnpm --filter @continuum/cli typecheck` — passed.

Interpretation: the evidence contract is stronger and ready for integration
into a successful provider cell. This change does not prove token reduction,
cache hits, or cost savings.

The repository-wide test pass also exposed and fixed a Codex client race where
`compactThread` returned after the request acknowledgement but before the
queued `thread/compacted` notification had reached callbacks. The method now
drains inbound and callback queues before returning, preserving completion
evidence ordering.

The live Codex smoke assertion was also made style-independent: the isolated
Node test remains the semantic gate, while harmless parameter renaming by the
provider is accepted.

A timestamp-ordering assumption in the context-ledger test was corrected to
select the asserted delivery by ID; UUID tie-breaking is intentionally not
treated as delivery order.

## 2026-09-20 — Implementation validation

Change: adaptive initial context profiles, deterministic preflight handoff,
and the `continuum_preflight` benchmark arm.

Commit: `f307d6d`

Validation:

- `pnpm build` — passed.
- `pnpm lint` — passed.
- context-engine session tests — passed.
- CLI standalone acceptance — passed.
- MCP session product tests — passed.
- Phase 6 recovery smoke — passed.
- Phase 6 preflight dry-run — passed.

Result: implementation is ready for live qualification. No provider tokens or
dollars were consumed by the dry-run.

## 2026-09-20 — Phase 1 deterministic cache-ready layers

Implementation: context packets now expose a content-addressed stable
repository prefix and task delta. Stable-prefix ordering is path/line/symbol
ordered and task-independent for a fixed snapshot; task-delta content records
the task class, risk, required/covered/missing coverage, exact item IDs, source
provenance, hashes, selected content, and omissions. Session handoff uses a
full prompt plus a manifest, while initial delivery sends the stable prefix once
and keeps the task delta in the existing item list rather than duplicating it.

Validation:

- `pnpm --filter @continuum/shared build` — passed.
- `pnpm --filter @continuum/context-engine typecheck` — passed.
- `pnpm --filter @continuum/codex-app-server typecheck` — passed.
- `pnpm --filter @continuum/cli typecheck` — passed.
- Context-engine test suite — 30 tests passed.
- Cache-plan regression tests verify task independence, deterministic ordering,
  snapshot invalidation, SHA-256 hashes, and provenance.

Interpretation: Continuum now has the compiler contract needed for a provider
cache adapter. No provider cache hit, token reduction, or cost reduction is
claimed until a host adapter sends the stable bytes repeatedly and provider
usage confirms cache-read behavior.

## 2026-09-20 — Phase 2 delivery receipts and restart persistence

Implementation: added migration 11 to persist versioned cache-layer delivery
payloads on context-session deliveries. Reconstructed initial-context packets
now retain the stable prefix after a new service/MCP process. MCP compact mode
includes the stable prefix and task-delta manifest without serializing the full
task delta a second time. Agent capability contracts now distinguish preflight,
MCP, stable-prefix reuse, explicit prompt cache, cache-read telemetry,
cache-creation telemetry, and native compaction. Phase 6 run artifacts now
write `continuum-delivery.json` and include it in the result/report stream.

Validation:

- `node --check scripts/phase6-agent-runner.mjs` — passed.
- Database tests — 24 passed with schema version 11.
- Context-engine tests — 31 passed, including cache-delivery persistence.
- MCP server tests — passed, including fresh-process progressive delivery.
- Provider cache savings remain unproven; receipts currently label cache
  observations as `not_reported` unless provider telemetry exposes a read.

## 2026-09-20 — Three-arm live qualification attempt

Configuration: one fixed task (`small-local-token-refresh`), one model
(`gemini-3.8-flash-medium`), one repetition, and three treatments:

- `continuum_off`
- `continuum_on`
- `continuum_preflight`

Artifact index:
`artifacts/phase6-qualification-20260920/20260919204017-seed-1789850417517/`

Outcome:

- 3/3 provider calls classified as `provider_quota`.
- 0 infrastructure failures.
- 0 measured usage records and 0 measured cost records.
- All three MCP setup/restore cycles completed with `restored` status.
- The preflight handoff artifact was generated successfully before its model
  call.
- `decisionReady: false`; no effectiveness or savings claim is valid.

Interpretation: the test harness and new preflight path are operational, but
the provider was unavailable for all model arms. Rerun the same manifest with
`--resume ... --execute --retry-provider-failures` after quota access is
restored.

## 2026-09-20 — OpenCode adapter smoke

Implementation: Phase 6 now accepts `--agent opencode` and model IDs such as
`opencode/big-pickle`. It parses OpenCode JSON events, records provider usage
when `step_finish` token data is present, and configures Continuum in a
disposable project-local `opencode.json`.

Dry-run validation passed for all three treatments. A live
`opencode/big-pickle` baseline and a 30-second MCP-on smoke both started the
OpenCode process, but emitted no JSON events and timed out. The MCP-on smoke
verified project configuration creation and restoration; no model usage or
cost was measured.

Artifacts:

- `artifacts/opencode-qualification-20260920/`
- `artifacts/opencode-mcp-smoke-20260920/`

Provider state after this smoke: OpenCode Zen is connected with one local
credential. The benchmark is intentionally restricted to the free model IDs
shown by `/models`; paid model IDs are rejected before execution.

After authentication, a free `opencode/big-pickle` baseline smoke was
attempted. It timed out after two minutes with zero JSON events, zero model
tool calls, and zero token usage. This does not measure Continuum and is not a
model-quality result; it indicates that this free model/provider path was not
responsive through the current OpenCode CLI invocation.

## 2026-09-20 — Small free-model gate

To limit quota use, only two cells were run: one task, one repetition, and
`opencode/mimo-v2.5-free` in `continuum_off` and `continuum_preflight`.

Both cells timed out after 30 seconds with zero JSON events, zero tool calls,
and no provider usage. Preflight generation and MCP restoration passed. No
larger OpenCode model matrix should be run until a simple OpenCode request
returns events successfully.

Artifacts:
`artifacts/opencode-small-gate-20260920/20260919212129-seed-20260920/`

## 2026-09-20 — Free-model retry

One additional baseline cell was attempted with
`opencode/muse-spark-1.2-contributor-free`, using the same task and a
30-second agent limit. It also timed out with zero JSON events, zero tool
calls, and no usage. No matching preflight cell was run because the model did
not pass the responsiveness gate.

Artifact:
`artifacts/opencode-retry-20260920/continuum-phase6-wzqDtn/`

## 2026-09-20 — Low Antigravity paired gate

Account: newly authenticated Antigravity account.

Configuration: `gemini-3.6-flash-low`, one task, one repetition, and a paired
`continuum_off` versus `continuum_preflight` comparison with a two-minute
agent limit.

| Metric | Baseline | Preflight | Change |
|---|---:|---:|---:|
| Provider input tokens | 52,603 | 42,485 | -19.2% |
| Provider total tokens | 53,672 | 43,837 | -18.3% |
| Cache-read tokens | 117,670 | 125,995 | +7.1% |
| Tool calls | 22 | 18 | -18.2% |
| Stream events | 37 | 31 | -16.2% |
| Duration | 130.5s | 131.5s | +1.0s |
| Verified task success | no | no | unchanged |

Both cells timed out before producing the required patch, so this is
preliminary efficiency evidence only. Provider usage was measured, but cost
was not because no pricing profile was supplied. The result suggests that
preflight reduces exploration/input usage for this low model, but it does not
yet demonstrate cost-per-success improvement.

Report:
`artifacts/agy-low-gate-20260920/phase6-report.json`

## 2026-09-21 — Phase 2 low-cost paired qualification gate

Configuration: one fresh `small-local-token-refresh` repository, one
authenticated Antigravity model (`gemini-3.6-flash-low`), one repetition per
treatment, pilot-shuffled order, and a two-minute agent limit. The preflight
cell happened to run first for seed `20260921`. The run used no pricing
profile, so dollar cost is unavailable by design. The generated per-cell
manifest incorrectly recorded `randomizedOrder: false`; the runner/pilot
metadata path was corrected afterward so future runs record the actual order
policy.

Artifacts:

- Run index: `artifacts/phase2-low-gate-20260921/20260920190336-seed-20260921/pilot-index.json`
- Report: `artifacts/phase2-low-gate-20260921/20260920190336-seed-20260921/phase6-report.json`
- Markdown report: `artifacts/phase2-low-gate-20260921/20260920190336-seed-20260921/phase6-report.md`

| Metric | `continuum_off` | `continuum_preflight` | Preflight − off |
|---|---:|---:|---:|
| Provider input tokens | 120,803 | 86,686 | -34,117 (-28.2%) |
| Provider total tokens | 131,056 | 92,207 | -38,849 (-29.6%) |
| Cache-read tokens | 567,192 | 341,528 | -225,664 (-39.8%) |
| Tool calls | 60 | 34 | -26 (-43.3%) |
| Stream events | 123 | 54 | -69 (-56.1%) |
| Duration | 92.9s | 130.9s | +38.0s (+40.9%) |
| Verified task success | yes | no | -1 success |

Delivery evidence was present in the preflight receipt: mode
`preflight_mcp`, stable-prefix estimate 816 tokens, task-delta estimate 2,354
tokens, and non-null content hashes. Antigravity reported cache reads in both
arms, but the receipt declares no explicit prompt-cache handle or stable-prefix
reuse; therefore those cache reads cannot be attributed to Continuum.

Interpretation: this is a valid telemetry and failure-diagnosis cell, not a
decision-grade effectiveness result. Preflight reduced measured provider
usage, but it timed out after 34 tool calls and failed the visible validator
(only the regression test changed); the independent hidden validator passed.
The baseline completed both visible and hidden validation. With one pair,
preflight-first order, no priced usage, and a correctness failure in preflight,
the result cannot support a token-saving, cost-saving, or production claim.
The next gate is to fix the preflight task-execution failure mode, then run
matched randomized repetitions with a versioned pricing profile.

Root-cause hypothesis and implementation follow-up: the preflight arm enabled
the MCP server while the off arm had no MCP server. The preflight first-turn
provider input was 19,315 tokens versus 5,349 baseline tokens, even though the
compiled handoff was estimated at 3,170 tokens. This is consistent with MCP
tool-schema overhead being included in the provider request; the run did not
isolate that factor, so it remains a hypothesis until rerun. The MCP server now
supports a targeted preflight surface containing only
`continuum_request_context`, and the runner enables it for preflight cells.
The regular MCP surface remains unchanged. Tool-surface and runner syntax
checks pass; a new paired run is required to measure the effect.

## 2026-09-21 — Targeted MCP surface rerun

After the first gate, preflight MCP was changed to expose only
`continuum_request_context`. The regular MCP surface was unchanged. A fresh
paired run used the same task/model/repetition and two-minute limit; baseline
ran first for seed `2026092121`.

| Metric | `continuum_off` | `continuum_preflight` | Preflight − off |
|---|---:|---:|---:|
| Provider input tokens | 158,100 | 77,861 | -80,239 (-50.8%) |
| Provider total tokens | 169,946 | 83,950 | -85,996 (-50.6%) |
| Cache-read tokens | 571,620 | 353,761 | -217,859 (-38.1%) |
| Tool calls | 60 | 31 | -29 (-48.3%) |
| Duration | 88.2s | 122.8s | +34.6s (+39.2%) |
| Verified task success | yes | no | -1 success |

The preflight arm completed without an agent timeout, but it changed only the
test and failed the visible required-path/semantic validator; hidden validation
passed. This confirms that reducing MCP schema overhead alone does not ensure
that the delivered context is sufficient for the edit.

Artifacts:
`artifacts/phase2-targeted-gate-20260921/20260920191600-seed-2026092121/`

## 2026-09-21 — Bounded dependency-context rerun

The retrieval engine was changed to follow one bounded second relationship hop
through a containing class/module, and a regression test now requires a sibling
implementation dependency to remain in a security-sensitive packet. A fresh
paired run used the same task/model/repetition and two-minute limit; baseline
again ran first for seed `2026092122`.

| Metric | `continuum_off` | `continuum_preflight` | Preflight − off |
|---|---:|---:|---:|
| Provider input tokens | 104,146 | 93,477 | -10,669 (-10.2%) |
| Provider total tokens | 116,068 | 100,648 | -15,420 (-13.3%) |
| Cache-read tokens | 524,219 | 430,874 | -93,345 (-17.8%) |
| Tool calls | 46 | 40 | -6 (-13.0%) |
| Duration | 88.2s | 129.3s | +41.1s (+46.6%) |
| Verified task success | yes | no | -1 success |

The preflight handoff now includes `AuthService.validateToken`, but the agent
still timed out before making either required edit under the two-minute cap.
The report is therefore not decision-ready. This isolates a remaining
host/model execution issue: the context and MCP delivery paths are producing
receipts, but this low model is not completing the task reliably within the
current cap when preflight is enabled.

Artifacts:
`artifacts/phase2-context-gate-20260921/20260920192243-seed-2026092122/`

## 2026-09-21 — Pure-preflight isolation attempt

Added the diagnostic `continuum_preflight_only` arm, which injects the same
preflight handoff but leaves MCP unavailable. The planned randomized order was
`continuum_off`, `continuum_preflight_only`, then `continuum_preflight`, using
the same task/model and a five-minute cap. The first baseline cell reached the
five-minute provider limit and was classified as `agent_timeout`; its visible
and hidden validators nevertheless passed and it produced the required patch.

| Metric | Baseline result |
|---|---:|
| Provider input tokens | 125,748 |
| Provider total tokens | 136,064 |
| Cache-read tokens | 592,398 |
| Tool calls | 58 |
| Duration | 316.0s |
| Validated patch | yes |
| Benchmark success | no — timeout classification |

The remaining two cells were intentionally stopped after the baseline timeout
to avoid spending two more provider windows without a valid paired control.
This confirms that `gemini-3.6-flash-low` is not currently a responsive,
decision-grade qualification provider even with a five-minute cap. Cost was
unavailable because Antigravity's `gemini-3.6-flash-low` tier does not expose a
matching public price profile; the public standard
[`gemini-3.6-flash` pricing](https://ai.google.dev/gemini-api/docs/pricing)
cannot be applied to it. The official model catalog identifies
`gemini-3.6-flash` as the public API model, not the Antigravity `-low` tier
([model catalog](https://ai.google.dev/gemini-api/docs/models)).

Artifacts:
`artifacts/phase2-isolation-gate-20260921/20260921042312-seed-2026092123/`

## 2026-09-24 — Outcome semantics and pure-preflight default

Implemented the next qualification improvement without spending another
provider window:

- `phase6-pilot.mjs` now defaults to `continuum_off,continuum_preflight_only`.
- `continuum_preflight` remains available for the explicit targeted-MCP
  comparison.
- New run artifacts include an `outcome` object distinguishing
  `patchValidated`, `agentFinishedWithinTimeout`, `providerTimeout`, and
  `verifiedTaskSuccess`.
- Reports now include validated-patch rate, completion rate, provider-timeout
  count, and cost per verified success when pricing is fully measured.
- `phase6-outcome.test.mjs` covers a valid patch after timeout, a completed
  valid patch, and an invalid patch.

The existing isolation artifact is intentionally not rewritten. Its baseline
remains historical `agent_timeout` evidence; new runs will classify explicit
`print timeout` signals as `provider_timeout` and preserve both outcome views.
No additional live run was started because the low Antigravity tier already
hit the five-minute cap without a matching public price profile.

## 2026-09-28 — Direct Gemini API smoke path

Added `scripts/gemini-api-smoke.mjs` for a single low-cost provider check. It
loads `GEMINI_API_KEY` from the ignored project `.env`, defaults to the newest
general-purpose Flash-Lite endpoint `gemini-3.5-flash-lite`, caps the response
at 16 tokens, and prints usage metadata without printing the key. The command
was not executed because no local replacement key was configured at that time.

## 2026-09-29 — Gemini 3.5 Flash-Lite smoke result

The project `.env` was saved with a local Gemini key and the direct smoke was
run exactly once against `gemini-3.5-flash-lite` with a 16-token output cap.
The request reached the Gemini API but returned HTTP 403: the project was
denied access. No benchmark cell was launched and no retry was made. The smoke
now reports this condition as `provider_project_access`; resolve project access
with the key's owning Google project before continuing.

## Earlier Phase 6 evidence

The repository contains preliminary smoke and pilot artifacts under
`packages/context-engine/benchmarks/v1/` and `docs/`. They are useful for
runner debugging but are not decision-grade because of quota failures, small
sample size, and incomplete independent evidence.

## Next controlled experiment

Run matched fresh-repository cells for the same task, model, and repetition:

1. `continuum_off`
2. `continuum_preflight_only`
3. `continuum_preflight` (only after the first pair is valid)

Measure verified task success first, then total input tokens, cached-input
tokens, output/reasoning tokens, estimated dollars, native search/tool calls,
Continuum delivery tokens, duration, and out-of-scope changes. Exclude or
rerun provider quota/auth failures; do not count them as task failures.

## 2026-10-13 — Third real Codex smoke: recovery verified; budget qualification failed

One authorized on_demand / Treatment C run, Luna/openai/low, two native completed
generation turns and one genuine compaction. SQLite recovery was received exactly
by the same thread; both final-code validators pass. Native compaction also retained
the requirement, so added causal value is unproven. Full reported native usage:
104,642 (including 11,732 compaction tokens absent from app-server notifications).
The 85k reactive guard marked the run failed at completion. No restart or extra run.
The omission was repaired and tested offline, not retested live. Evidence and
limitations: docs/phase-next/context-efficiency-2026-10-13/report.md.

## 2026-10-13 — Four-treatment real Codex warehouse pilot

Frozen source e592458ee369b7b1dc82bb197537e1817f200f0f; native/full/minimal/adaptive,
Luna/openai/low, one randomized sequential run each. All four complete two turns
and pass 16 independent behavioral checks plus public/scope validation. Reported
totals: 139,654 / 185,645 / 255,744 / 176,185; combined 757,228. Zero compactions,
Continuum retries, observable host retries, cancellations or timeouts. Actual
billing unavailable. Native uses fewest tokens; full has shortest duration.
Minimal's first wrapped retrieval call is rejected; B/C attempt unavailable npm
before correctly using the instructed Node command. Post-study compatibility and
measurement repairs are offline only. No superiority conclusion from n=1.
See [evidence and complete report](phase-next/comparative-pilot-2026-10-13/report.md).
