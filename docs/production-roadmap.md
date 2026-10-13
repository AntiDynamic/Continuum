# Continuum Production Roadmap

Updated: 2026-09-21

## Purpose and release decision

Continuum may be published as a production context optimisation product only
after it can demonstrate, on controlled coding tasks, that its delivery method
lowers **provider cost per verified task** without materially reducing task
success, safety, or scope discipline.

This roadmap is intentionally ordered by evidence. It does not authorize a
claim of token or cost savings until the corresponding measurement and quality
gates pass. Detailed benchmark rules remain in
[effectiveness-gate-plan.md](effectiveness-gate-plan.md).

## Product thesis

Continuum should be a provider-aware context runtime:

```text
task + repository snapshot
          |
          v
  context compiler -------------------> stable repository prefix/cache handle
          |                                          |
          v                                          v
  task-specific context delta ----------------> first model request
                                                       |
agent reads/edits/tests <--- targeted MCP deltas <----+
          |                                          |
          +---------- receipts + provider usage ------+
                             |
                             v
              verified-success and cost evidence
```

MCP is retained for interactive, targeted context and recovery. It is not the
only delivery path: a model-controlled tool call occurs too late to prevent
unnecessary first-turn exploration. The host integration must attach the
preflight context before the first request and, where available, use the
provider's prompt-cache mechanism.

## Non-negotiable design principles

1. **Verified success before efficiency.** A token reduction on a failed,
   censored, or out-of-scope task is not a product win.
2. **Measured provider data before dollar claims.** Packet estimates and
   provider usage are different quantities and must remain separately labelled.
3. **Stable before dynamic.** Repository-wide material is a stable,
   snapshot-bound prefix; task material is a short delta. Never reshuffle the
   stable prefix between turns.
4. **Exact code beats lossy summaries for edits.** Summaries may describe
   architecture and state; edit-critical material must retain file identity,
   lines/symbols, content hash, and provenance.
5. **Progressive disclosure.** Start with enough context to act, then deliver
   small deltas only for an explicit coverage gap, failed validation, or newly
   discovered dependency.
6. **Every decision is auditable.** A receipt records what was delivered,
   omitted, reused, superseded, and later evidenced as consumed.
7. **Provider capabilities are explicit.** Unsupported cache or telemetry
   features degrade to an honestly labelled mode; they never silently emulate a
   cost claim.

## Workstreams and sequence

### Phase 0 — Freeze the measurement contract

**Objective:** make any subsequent experiment interpretable.

Deliverables:

- A provider-neutral run identity created before context-session creation and
  persisted on the context session, provider events, receipts, and benchmark
  artifact.
- A normalized per-turn usage schema: input, cached input/read, cache write,
  output, reasoning, tool-call count, duration, provider/model, and raw-source
  reference.
- A versioned pricing-profile schema with effective date, currency, provider,
  model, cache-read and cache-write rates, and profile hash.
- A report that makes **cost per verified successful task** primary; censored,
  timeout, provider, and infrastructure failures stay outside that denominator.
- A capability matrix for each host/provider combination: preflight injection,
  explicit cache, implicit cache observation, native compaction, usage fields,
  MCP resources/prompts/tools, and isolation guarantees.

Acceptance criteria:

- One fixture run can trace a provider usage event to exactly one Continuum
  session and packet receipt.
- Missing telemetry is reported as unavailable, not inferred from packet size.
- A pricing calculation is reproducible from stored raw usage and profile hash.
- Report tables expose preflight-versus-off pairs as prominently as late-MCP
  pairs.

Stop/go: do not spend on multi-model effectiveness testing until this phase is
complete for at least one responsive provider path.

### Phase 1 — Build the context compiler

**Objective:** create cacheable, deterministic context that remains useful for
coding work.

Deliverables:

- `StablePrefix`: repository snapshot identity, compact repo map, conventions,
  key public symbols, dependency/test topology, and allowed tooling policy.
- `TaskDelta`: task contract, predicted edit/test paths, exact relevant
  snippets, risks, required coverage, validation command, and explicit
  omissions/uncertainties.
- Content-addressed packet IDs and hashes for every section; deterministic
  ordering and a recorded token estimate.
- Hybrid ranking: lexical task signal + symbols/AST + import/call/test graph +
  recent change signal + risk rules. Add a task-family-specific budget policy.
- Guardrails for incomplete coverage: the packet says what is missing and gives
  the agent a targeted next context request rather than pretending completeness.

Acceptance criteria:

- The same task and repository snapshot produce byte-stable stable-prefix
  content and ordering.
- Mutation tests show mandatory files/tests are retained for each benchmark
  task family.
- Packets contain no duplicate text except when explicitly recorded as required
  repeated context.
- Context-item provenance supports navigation to source file, symbol/line
  range, snapshot, and hash.

Stop/go: do not enable provider cache handles until prefix stability and
snapshot invalidation are validated.

### Phase 2 — Provider-aware delivery adapters

**Objective:** turn compiled packets into cost-aware first-turn delivery.

Deliverables:

- A host adapter interface that can compose the initial request, retain a
  stable prefix, attach the task delta, observe streamed usage, and expose
  native compaction where the host supports it.
- Gemini adapter: prefer explicit cached content for a reusable stable prefix
  where the selected API/host permits it; otherwise preserve the identical
  prefix for implicit caching and capture cached-token telemetry.
- OpenAI/Codex adapter: use the host's supported state/compaction mechanism;
  label any unavailable prompt-cache telemetry rather than guessing it.
- Claude adapter: add cache breakpoints at the final stable block and capture
  cache-read and cache-write usage separately.
- MCP integration in all adapters: publish the session ID, expose only
  targeted delta/recovery operations, and use project-scoped configuration.
- Feature flags for preflight, cache mode, delta policy, and native compaction
  so experiments can isolate each mechanism.

Acceptance criteria:

- A preflight packet is present in the agent's first request in every supported
  adapter test.
- Stable prefix is reused unchanged for subsequent turns until snapshot or
  policy changes invalidate it.
- The adapter records actual cache usage when the provider emits it; explicit
  cache creation/expiry is also recorded where applicable.
- Disabling Continuum produces a semantically equivalent task prompt without
  Continuum context or MCP access.

Stop/go: no cache-savings claim until an adapter reports non-null cache and
pricing evidence in a successful paired run.

Current implementation progress: the preflight host path now persists and
replays the stable-prefix payload, returns a task-delta manifest, preserves the
prefix through compact MCP responses, and records a delivery receipt in Phase 6
artifacts. Preflight cells use a targeted MCP tool surface so unused lifecycle
schemas are not injected into the first request. Explicit provider cache
handles and provider-native cache billing remain deliberately unimplemented
until their APIs and telemetry are verified.

### Phase 3 — Context-use and recovery evidence

**Objective:** prove that delivery influenced work rather than merely adding
tokens to a prompt.

Deliverables:

- Receipts that correlate context item IDs with agent file reads, tool calls,
  edits, test failures, validation commands, and model turns when observable.
- `actuallyUsedItemCount` derived only from this evidence, with an
  `unobservable` state where host telemetry cannot support attribution.
- A structured recovery packet: objective, completed work, active paths,
  decisions, validation state, blockers, next action, coverage remaining, and
  source packet IDs.
- Native-compaction event tracking and a replay/recovery test suite at 1, 3,
  5, and 10 compaction windows.

Acceptance criteria:

- Every delivered item ends in one of: used, unused, superseded, omitted,
  unavailable-to-observe.
- Recovery preserves verified requirements and active edits without copying the
  entire prior transcript.
- A recovery experiment has no hidden-test regression relative to an
  uninterrupted control, within the predeclared tolerance.

### Phase 4 — Qualify effectiveness at low cost

**Objective:** establish whether Continuum helps before broad compatibility
work or marketing.

Run order:

1. Gate 0: one responsive-provider smoke cell with events and non-null usage.
2. Gate 1: one randomized `continuum_off` versus
   `continuum_preflight_only` pair; add targeted MCP only as a secondary arm.
3. Gate 2: six matched pairs: two repetitions of local bug, cross-file or
   security-sensitive change, and migration/configuration task.
4. Gate 3: add `continuum_on` to the same tasks, isolating late MCP from
   preflight delivery.
5. Gate 4: five repetitions per selected task/model/treatment; report paired
   medians and uncertainty intervals.

Required controls:

- Fresh repository for every cell; snapshot/restore all MCP configuration.
- Same model, task, prompt contract, timeout, tool permissions, fixture, and
  validation for paired arms.
- Randomized treatment order and recorded seed.
- Visible tests, independent hidden tests, patch scope, required-path checks,
  and diff hygiene.
- Hard time and spend caps; stop on two consecutive provider failures or
  unavailable usage telemetry.

Decision criteria:

- **Promising:** at least two valid pairs, usage in at least 80% of cells,
  no meaningful correctness regression, and median input reduction of at least
  10%.
- **Working for a task family:** verified success across all chosen task
  families, no treatment success drop greater than 10 percentage points,
  median input reduction of at least 15%, and neutral-or-lower native
  exploration.
- **Cost saving:** the preceding criteria plus a lower median measured cost per
  verified task using a versioned provider pricing profile.

### Phase 5 — Production hardening and beta

**Objective:** make results safe, repeatable, and useful on real repositories.

Deliverables:

- Local-first storage, explicit retention controls, redaction rules, encrypted
  secrets handling, and a documented threat model for code/context data.
- Project-scoped MCP configuration only; dirty-worktree detection, isolated
  benchmark worktrees, bounded process/network permissions, cancellation, and
  cleanup guarantees.
- Schema migrations, compatibility tests, structured errors, circuit breakers,
  bounded retries, and health/capability diagnostics.
- A human-readable report that distinguishes measured, derived, estimated, and
  unavailable values; include packet and pricing provenance.
- Opt-in beta with a small set of real repositories. Collect anonymized
  aggregate telemetry only with explicit consent and retain raw code locally by
  default.

Pure preflight is the default qualification path; MCP is added only after the
packet-only comparison is valid.

Release criteria:

- Phases 0–4 pass for at least one supported provider path.
- No unresolved high-severity data-isolation, destructive-action, or benchmark
  validity issue.
- Install, uninstall, recovery, and configuration restoration acceptance tests
  pass on supported platforms.
- Public documentation makes only evidence-supported claims and names the
  supported provider/host versions.

## What not to do yet

- Do not add a general-purpose autonomous sub-agent merely to save tokens. It
  adds orchestration, prompt, and failure cost unless a benchmark proves it
  improves cost per verified task.
- Do not expand to many providers while the first provider lacks valid
  telemetry and successful paired cells.
- Do not infer billed savings from fewer total tokens, lower Continuum packet
  estimates, or cached-token counts without a pricing profile.
- Do not inject whole files/repositories or rely on embedding-only retrieval.
- Do not publish aggregate claims from timeout-, quota-, or authentication-
  censored runs.

## Immediate next milestone

Complete the **Phase 4 Gate 1 exit** for the Antigravity/Gemini runner. The
delivery and usage receipts now work, but the first low-cost preflight pair
failed the visible task validator and had no pricing profile. First reproduce
the preflight failure with a focused fixture/debug run and make the handoff
preserve task-execution correctness; this has now been fixed and regression
tested, but the low model still exceeded the two-minute cap. Next run a
randomized, priced pair with a provider-appropriate cap (for example five
minutes), both arms successful, and no meaningful correctness regression before
expanding to the six-pair qualification set. The low Antigravity tier has now
also hit the five-minute cap on baseline, so use a responsive API/provider
model with a matching versioned price profile for that gate.

## Maintainer checklist

For every material change or experiment:

1. Update [project-context.md](project-context.md) with current status/gaps.
2. Add a decision and rationale to [decision-log.md](decision-log.md) when the
   design changes.
3. Add commands, artifacts, outcome, and interpretation to
   [experiment-log.md](experiment-log.md).
4. Record commit IDs and validation commands.
5. Preserve the distinction between estimated context, observed provider usage,
   derived cost, and verified success.
