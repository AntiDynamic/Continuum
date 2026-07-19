# Deterministic retrieval benchmark

Version 1 lives under packages/context-engine/benchmarks/v1. The controlled dataset has 24 manually labelled cases across a small TypeScript repository, a TypeScript monorepo, and a SQL/documentation repository. Labels were written before retrieval and are not derived from Continuum rankings. Real-repository labels were also persisted before execution.

## Metrics

- Recall@k = mandatory path and symbol requirements found by rank k / all mandatory requirements.
- Precision@k = declared relevant candidates in the first k positions / k.
- Reciprocal rank = 1 / rank of the first mandatory requirement; MRR is its mean.
- Mandatory coverage recall = required coverage categories represented in the selected packet / required categories.
- Initial and total selected tokens use Continuum's estimator, not provider tokenization.
- Irrelevant count uses explicitly declared irrelevant item patterns.
- Retrieval latency measures only production ContextEngine.search with a local high-resolution clock.
- Duplicate full-content resend rate compares content hashes returned as new content on first and repeated requests.

Aggregates are macro averages. Medians use the middle value or mean of the two middle values.

## Ablations

The benchmark reorders the same production candidate set without changing production defaults:

- lexical only: exact symbol/title/path, lexical and contextual-header evidence, snapshot and penalties;
- lexical plus graph: adds dependency, test, architecture, configuration, and prior-episode relations;
- lexical plus coverage: adds task-class and risk-coverage components;
- lexical plus graph plus coverage: combines those components;
- full: the production candidate score.

Packet selection stays fixed for an ablation case, so packet-token, coverage, and latency values describe the shared production pass.

## Reproduction and evidence

    pnpm benchmark:retrieval
    node scripts/retrieval-benchmark-real.mjs

Structured outputs are results.json and real-results.json. The measured environment was Windows x64, Node v24.13.0, Intel64 Family 6 Model 140, 8 logical processors, and 8,215,093,248 bytes of memory.

Evidence labels: retrieval quality measured; latency measured locally; tokens estimated; provider cost unavailable; task success not evaluated.

This benchmark measures retrieval quality, not coding-task success. It does not prove provider cost savings. Provider-exact telemetry and native Codex execution are not yet integrated.

## Phase 3D hardening

Production packets now use a 1,900-estimated-token hard ceiling with separately budgeted orientation, exact implementation, mandatory constraints/contracts, directly related tests, and optional context. Escalation candidates are metadata-only. The runner records p50, p90, and maximum packet size and retrieval-stage latency, plus per-item and aggregate real-repository packet composition. See [phase3d-go-no-go.md](phase3d-go-no-go.md) for preserved before/after evidence and the gate decision.

Identifier normalization is deterministic and versioned as `deterministic-identifier-normalization-v1`. It covers camel/Pascal case, snake/kebab case, paths, digit boundaries, conservative singular/plural variants, and joined/separated identifier forms. Ground truth, ambiguous labels, metric formulas, and thresholds were not changed.
