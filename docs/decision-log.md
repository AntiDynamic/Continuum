# Continuum Decision Log

## 2026-10-12 — Durable recovery at a supported continuation boundary

Reuse the context session database, index versions, Codex client, and assist
runner. Preserve original evidence; record explicit supersession; distinguish
user requirements, host observations, and agent reports. Restore critical
state before a continued turn, keep native compaction, and reject recovery
overflow and effective model/reasoning drift. Use deterministic local tests
and isolated development fixtures before paid evaluation. See the
[implementation and limitations](phase-next/implementation.md).

## 2026-10-12 — Implement audit repairs before effectiveness claims

Require executable visible and hidden validation, failing fixture baselines,
canonical budgeted deliveries, explicit snapshot refresh, nullable provider
cost, and isolated comparison worktrees. Keep `decisionReady` false until
held-out and live-provider evidence qualifies the product claim. See the
[implementation record](audit/implementation-2026-10-12.md).

## 2026-10-12 — Retire superseded paths and prioritize evidence validity

Decision: retain one active context compiler/retrieval path and remove the
unreachable legacy CLI indexer, legacy extractors/ranking/packing, unused
compatibility wrappers and dependencies, source-rewriting scratch scripts,
duplicate generated test files, and tautological Codex regression assertions.
Do not remove fixture distractors, subprocess entrypoints, migration history,
or current experiment tools merely because a static analyzer reports them.

Rationale: dead implementation branches and false test passes obscure the
runtime that actually needs qualification. The repository audit reproduced
failures in behavioral verification, budget enforcement, evolving snapshots,
receipts, comparison initialization, redaction, and attribution. Prioritize
an executable offline evaluator and a working edit/test/context-refresh loop
before expanding provider experiments or advertising optimization.

Evidence: [repository audit](repository-audit-2026-10-12.md) and
[offline results](audit/results-2026-10-12.json). Existing uncommitted work is
preserved. No new live-provider effectiveness result is implied.

This log records decisions that should survive context compaction and repeated
agent sessions.

## 2026-09-24 — Make pure preflight the default qualification arm

Decision: new Phase 6 pilot runs default to `continuum_off` versus
`continuum_preflight_only`. Keep `continuum_preflight` as an explicit
preflight-plus-targeted-MCP diagnostic arm.

Reason: the first request should test the packet itself before adding MCP
schema and tool-call overhead. MCP remains available as a follow-up strategy,
but it should earn its token and latency cost in a separate comparison.

## 2026-09-24 — Separate patch validity from completion

Decision: every new run records patch validation, agent completion within the
timeout, provider timeout, and verified task success as separate outcomes.

Reason: the five-minute baseline produced a patch that passed visible and
hidden validation but was terminated by the provider timeout. Counting it as a
success overstates completion, while counting it only as a failure discards
useful correctness evidence. Cost per verified success is reported only when
all run costs have measured pricing provenance.

## 2026-09-20 — Use preflight as a separate treatment

Decision: keep ordinary MCP (`continuum_on`) and prompt-injected preflight
(`continuum_preflight`) as separate experiment arms.

Reason: MCP tools are invoked during an agent session, so a model may already
have spent tokens on broad exploration before requesting Continuum context.
Combining both behaviors would make it impossible to identify whether savings
came from retrieval quality or earlier delivery.

## 2026-09-20 — Adapt the initial packet by task risk

Decision: use four first-delivery profiles rather than one fixed token budget.

Reason: routine local tasks should not pay for broad orientation, while
security, migration, and cross-package tasks need more constraints and
contracts. Required coverage must remain explicit when the budget cannot fit
it; it must never disappear silently.

## 2026-09-20 — Do not claim cache savings from estimated packets

Decision: report estimated Continuum packet tokens separately from provider
input, cached-input, output, reasoning, and cost measurements.

Reason: a smaller internal packet is not proof that the model received fewer
tokens or that a provider applied a cache discount. The adapter must expose
usage, and repeated controlled runs must confirm the effect.

## 2026-09-20 — Preserve usage snapshots and cache creation separately

Decision: retain every normalized usage event in an append-only snapshot table,
link the run-level aggregate to its source event, and model cache-creation
input tokens and pricing separately from cache reads.

Reason: a single mutable usage row cannot prove which provider event supplied a
measurement or distinguish a cache write from a cache hit. Cache writes may
have different billing, so combining them with cached-input reads would make
cost comparisons unreliable.

## 2026-09-20 — Separate stable repository context from task delta

Decision: compile every packet into a snapshot-bound `stablePrefix` and
`taskDelta`. The stable prefix contains deterministic repository-map metadata
and content hashes; the task delta contains the task contract, exact selected
context, provenance, coverage state, and omissions. Both layers have canonical
content hashes, while external session delivery returns the stable content plus
a task-delta manifest to avoid sending the task context twice.

Reason: a provider or host can reuse an unchanged prefix only if its bytes and
ordering are stable. Task text, ranked retrieval order, timestamps, random IDs,
and exact snippets must not be mixed into that prefix. Snapshot identity is part
of both layers so stale context cannot be reused after indexing or worktree
changes. This enables cache-aware adapters later without claiming that the
provider has already applied a cache discount.

## 2026-09-20 — Persist delivery payload separately from provider evidence

Decision: persist the stable-prefix payload and task-delta manifest on the
initial context delivery. Expose that delivery metadata through MCP and
benchmark receipts, while keeping provider cache observations and measured
usage as separate fields.

Reason: a session must be recoverable after the MCP process or host adapter
restarts, but an unchanged Continuum packet must not be mistaken for a provider
cache hit. The persisted receipt proves what Continuum sent; only provider
usage can prove what the provider reused or billed as cached.

## 2026-09-21 — Treat the first low-cost preflight result as diagnostic

Decision: do not promote the observed preflight token reduction to an
effectiveness or cost-saving claim. Require a successful, priced, randomized
paired run before advancing the qualification matrix.

Reason: the one preflight arm used 29.6% fewer measured total tokens but timed
out and failed the visible task validator, while the baseline succeeded. The
provider also reported cache reads in both arms without an explicit cache
handle or stable-prefix reuse, so the cache reads cannot be attributed to
Continuum. A lower token count on an unsuccessful task is not a product win.

## 2026-09-21 — Keep preflight MCP tool schemas minimal

Decision: when preflight context is injected before the first model turn, use a
targeted MCP registry exposing only `continuum_request_context`; retain the
full session lifecycle tools for ordinary interactive MCP treatment.

Reason: a preflight cell must not pay the schema cost of tools it is instructed
not to call. The first low-cost gate showed 19,315 first-turn input tokens with
preflight versus 5,349 without MCP, despite a 3,170-token compiled handoff.
That difference is a strong diagnostic signal for tool-schema overhead, but it
must be confirmed with a follow-up run before being treated as a measured
causal reduction.

## 2026-09-21 — Preserve bounded sibling dependencies in initial context

Decision: when an edit-critical symbol is retrieved, follow one bounded
relationship hop through its containing class or module and retain relevant
sibling symbols in the candidate pool.

Reason: the first preflight packet included `AuthService.refreshToken` but
omitted its sibling `AuthService.validateToken`, even though the task required
refresh to preserve validation behavior. The agent then added only a test and
did not make the implementation change. The fix is bounded to avoid broad
repository scans and is covered by a context-engine regression test.

## 2026-09-21 — Do not qualify on the low Antigravity tier yet

Decision: stop expanding the qualification matrix on
`gemini-3.6-flash-low` until a responsive provider path is available.

Reason: the baseline arm reached the five-minute cap while producing a valid
patch, so the benchmark must conservatively classify it as censored rather
than a successful task. Continuing the pure-preflight and MCP-preflight cells
would spend provider windows without a valid control. Use a matching public API
model and versioned price profile for the next decision-grade run.

## Earlier decisions

The broader Phase 5 and Phase 6 decisions remain in:

- [Phase 5 plan](phase5-plan.md)
- [Phase 6 effectiveness plan](phase6-agent-effectiveness-plan.md)
- [Context efficiency research](context-optimization-research-2026-09.md)

## 2026-10-13 — Explicit preload strategies and compaction-inclusive accounting

Keep initial_packet as the default. Add configured minimal_manifest/on_demand using
existing retrieval and task memory; omit initial recovery text when already present
in user input, but restore critical evidence at persistent continuation boundaries.
Record delivery receipts and distinguish local estimates, native per-response usage
and unavailable active context occupancy. Genuine 0.162.1 compaction usage can be
absent from app-server cumulative notifications; reconcile its native record before
continuation and block missing/ambiguous accounting. See the context efficiency report.

## 2026-10-13 — Freeze a four-treatment comparative pilot

Preserve initial_packet as default. Add experimental adaptive delivery using
existing retrieval and durable memory at controlled boundaries. Native control
receives no Continuum tools or input. Independent multi-file warehouse validators
and negative controls precede all inference. Use fresh isolated Git clones and
frozen task/evaluator/compiled hashes. Do not optimize based only on smaller packets.
See the comparative pilot design for calibrated reactive budgets and limitations.

## 2026-10-13 — Repair observed retrieval failure; defer default/policy changes

The four-arm warehouse pilot passes all behavioral assertions but provides no
correctness advantage for Continuum, and every Continuum observation consumes more
total reported tokens than native. Keep initial_packet as default until repeated
controlled evidence warrants a change. Normalize the single argument wrapper seen
in Minimal's failed retrieval, with type/conflict guards. Expand delivery auditing
to include dynamic tool replies. Both repairs are deterministic and independently
committed after the frozen study; no additional inference. Dynamic deduplication,
selective recovery and narrower tool surfaces require subsequent controlled study.
