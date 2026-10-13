# Continuum Effectiveness Gate Plan

Updated: 2026-09-20

2026-10-12 extension: the [autonomous recovery phase](phase-next/implementation.md)
adds native A / retrieval B / durable recovery C preparation with paid runs
blocked pending approval. Its development fixtures, mocked compaction,
filesystem probes, and persistence tests establish infrastructure behavior.
They do not satisfy the live effectiveness gates below. Historical pattern-only
success labels require executable behavioral revalidation.

## Decision we need to make

Does Continuum reduce provider context/exploration cost while preserving the
agent's ability to complete a task correctly?

The current low-model pair is not enough to answer this. It measured lower
usage in preflight, but both arms timed out and failed verification. We treat it
as a mechanism signal, not a product success.

## What counts as working

Continuum is working only when all of these are true:

1. The provider run is valid: it emits model events, reports usage, and is not
   quota-, authentication-, infrastructure-, or timeout-censored.
2. The task is correct: visible validation, hidden validation, patch scope, and
   required-path checks all pass.
3. The treatment is efficient: measured provider input tokens and/or measured
   cost are lower than the paired baseline for the same task, model, and
   repetition.
4. The result is repeatable across multiple fresh repositories and tasks.

Lower Continuum-estimated packet tokens alone do not satisfy this definition.

## Treatments

Each matched cell uses the same task, model, fixture, prompt requirements,
timeout, and fresh repository:

- `continuum_off`: no Continuum context or MCP.
- `continuum_on`: the agent receives Continuum through MCP and chooses when to
  request its initial context.
- `continuum_preflight`: Continuum context is injected before the first model
  turn; MCP remains available for targeted deltas.
- `continuum_preflight_only`: the default low-cost pure-preflight arm with the
  same injected context but no MCP registry, isolating prompt delivery from
  MCP tool-schema overhead.

The main causal comparison is `continuum_preflight_only` versus
`continuum_off`. The MCP-enabled `continuum_preflight` arm is a secondary
diagnostic comparison used to measure whether targeted MCP adds value after
the handoff. The `continuum_on` arm explains whether late model-invoked MCP is
weaker or stronger than preflight delivery.

## Metrics

### Correctness gate

- verified task success;
- validated patch rate, even when the provider times out afterward;
- agent-finished-within-timeout rate;
- provider timeout rate;
- visible and hidden validation status;
- patch-scope status;
- required-path changes;
- timeout and provider-failure category.

### Provider efficiency

Primary:

- measured input tokens;
- measured total tokens;
- measured cost when a versioned pricing profile is available.

Secondary:

- cache-read tokens;
- output and reasoning tokens;
- native tool calls and stream events;
- duration;
- Continuum estimated context and duplicate tokens avoided.

Provider usage must come from the adapter artifact. Continuum estimates must
never be substituted for provider measurements.

## Staged test plan

### Gate 0 — provider responsiveness

One low model, one trivial controlled prompt, and a short timeout. Continue
only if the model emits events and non-null usage. If it fails, stop model
testing and fix authentication, connectivity, or adapter behavior.

### Gate 1 — mechanism qualification

Use one low model and one representative task. Run one matched
`continuum_off`/`continuum_preflight_only` pair. Existing preflight evidence is
diagnostic only: it showed lower token counts, but the low model did not
complete the task reliably, so it remains inconclusive.

### Gate 2 — small qualification set

Run two repetitions across three task families with only
`continuum_off` and `continuum_preflight_only`:

- local bug;
- security-sensitive or cross-file change;
- configuration/documentation or migration task.

This is six matched pairs. Stop immediately if two consecutive cells are
provider failures, if usage is unavailable, or if preflight causes a clear
correctness regression.

### Gate 3 — treatment comparison

Only if Gate 2 is valid, add `continuum_on` for the same six pairs. This
separates the value of early context from the value of a late MCP request.

### Gate 4 — confirmation

Use at least five repetitions per task/model/treatment across the selected
task families. Report paired medians and uncertainty intervals. A final claim
requires measured pricing as well as token telemetry.

## Pass criteria

### Preliminary “promising” result

- usage measured in at least 80% of cells;
- no meaningful correctness regression;
- median input-token reduction of at least 10%;
- at least two valid matched pairs showing the same direction.

### “Working for this task family”

- all selected task families retain verified success;
- no arm has a success-rate drop greater than 10 percentage points from the
  baseline;
- median input tokens decrease by at least 15%;
- native exploration/tool calls decrease or remain neutral;
- the result holds in Gate 3 or Gate 4.

### “Cost saving”

The previous criteria must pass and a manually versioned pricing profile must
show lower median cost per verified task. Cache-read tokens are cost evidence
only when the provider pricing and telemetry define how they are billed.

## Current conclusion

The `gemini-3.6-flash-low` pair is:

- provider-valid for usage telemetry;
- correctness-invalid because both runs timed out;
- efficiency-promising: preflight used 42,485 input tokens versus 52,603;
- cost-undetermined because no pricing profile exists;
- not sufficient to declare Continuum effective.

## Required safeguards before the next stage

- Keep free/low model selection explicit.
- Keep a hard cell and timeout budget.
- Stop on repeated provider failures.
- Exclude censored runs from effectiveness denominators.
- Record every run directory and report in `docs/experiment-log.md`.
- Do not call a treatment successful unless correctness and efficiency both
  pass.
