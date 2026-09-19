# Continuum Experiment Log

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

## Earlier Phase 6 evidence

The repository contains preliminary smoke and pilot artifacts under
`packages/context-engine/benchmarks/v1/` and `docs/`. They are useful for
runner debugging but are not decision-grade because of quota failures, small
sample size, and incomplete independent evidence.

## Next controlled experiment

Run matched fresh-repository cells for the same task, model, and repetition:

1. `continuum_off`
2. `continuum_on`
3. `continuum_preflight`

Measure verified task success first, then total input tokens, cached-input
tokens, output/reasoning tokens, estimated dollars, native search/tool calls,
Continuum delivery tokens, duration, and out-of-scope changes. Exclude or
rerun provider quota/auth failures; do not count them as task failures.
