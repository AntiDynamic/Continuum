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
