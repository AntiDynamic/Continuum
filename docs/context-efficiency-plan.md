# Continuum Context-Efficiency Foundation Plan

## Current working functionality

- The TypeScript monorepo builds around a provider-neutral `AgentAdapter` abstraction.
- The CLI can initialize repositories, run the Gemini or deterministic fake adapter, index supported files, retrieve lexical context, report runs, record outcomes, and compare two runs.
- Agent events, Git snapshots, file changes, test executions, usage metrics, and user outcomes persist in local Node SQLite.
- Repository indexing extracts TypeScript, Markdown, JSON, YAML, and SQL content into version-shaped context records.
- SQLite FTS5 is probed at runtime and a lexical fallback exists.
- Redaction, adapter-contract, database, evaluator, MCP, indexing, and CLI integration tests exist.
- The release-readiness repair preceding this plan restored the corrupted CLI test suite and made build, typecheck, lint, and tests pass.

## Current broken functionality

- Context packing budgets characters and describes them as roughly equivalent to tokens without a typed estimator or evidence label.
- The context command prints snippets but does not persist delivery, duplicate suppression, stage, presence, or packet accounting.
- The advertised “optimized context” wording overstates a simple lexical/BM25 ranking implementation.
- The FTS repository catches every error as if FTS5 were unavailable, logs to stderr, and then silently changes search behavior.
- FTS scores are transformed with `Math.abs`, which destroys SQLite BM25 ordering semantics.
- Generated JavaScript test artifacts are committed beside TypeScript tests in the repository-indexer package, causing duplicate execution.
- `CHANGELOG.md` is absent.
- The README roadmap previously disagreed with the implemented V2 preview; it is being aligned in this stage.

## Data-integrity risks

- Indexed versions are written with `valid_to_commit_exclusive: null` and often `provenance_json: null`; no lifecycle closes superseded versions.
- Worktree snapshots currently use `worktree_hash: null`, so dirty snapshot identity is incomplete.
- Context retrieval records what was returned, not what was actually supplied to an agent.
- No repository boundary protects a run from receiving a context item belonging to another repository.
- Usage metrics are unstructured name/value rows; provider, model, and measurement evidence can be lost.
- Pricing does not exist, so costs cannot be reproduced against a versioned profile.
- Broad `any` casts and broad catches in indexing/MCP/database code weaken schema guarantees and can misclassify operational failures.

## Measurement gaps

- The primary metric, total credits per accepted verified task, cannot currently be computed.
- Input, cached-input, output, and reasoning tokens do not share one provider-neutral evidence contract.
- Model identity and pricing version are not persisted with usage evidence.
- Retries, unrelated changes, context supplied, context stages, and context packet sizes are absent from reports.
- Reports label stored token rows as exact even when the underlying evidence source is not encoded.
- Missing telemetry is not represented as a typed evidence object.

## Context-cost gaps

- No deterministic `TokenEstimator` boundary exists.
- Packet totals do not distinguish metadata, code, documentation, and tests.
- New delivery is not separated from duplicate content.
- Historical and stale exclusions are not measured.
- There is no valid experimental baseline, so current code must not claim savings or a savings percentage.
- “Potential duplicate tokens avoided” is the strongest honest claim available before controlled experiments.

## Agent integration gaps

- `AgentCapabilities` exposes one coarse `tokenUsage` boolean instead of field-level telemetry capabilities.
- Gemini emits a legacy `token_usage` event; provider-neutral `agent_usage` normalization is absent.
- The fake adapter does not provide a deterministic usage event suitable for end-to-end cost tests.
- Context retrieval and agent execution are not linked through a delivery ledger.
- The CLI has no typed, versioned pricing workflow.

## Security risks

- Telemetry and pricing metadata need the same redaction guarantees as agent messages and tool inputs.
- Context ledger writes need cross-repository validation.
- Raw payload capture remains policy-controlled, but new provider/model fields must never contain unredacted secrets.
- Broad error catches can hide malformed queries and database faults.
- Unsafe auto-approval remains intentionally explicit and must not be enabled by context features.

## Required implementation sequence

1. Add typed context-efficiency, pricing, usage-evidence, token-estimation, and ledger contracts.
2. Add an append-only pricing profile schema plus usage, cost, context-packet, and context-delivery tables.
3. Add repositories enforcing run/item repository boundaries and duplicate-delivery decisions.
4. Normalize adapter telemetry while retaining backward compatibility with legacy token events.
5. Integrate evidence-labelled usage and cost calculation into orchestration and reporting.
6. Add pricing, context search/pack, JSON report, and HTML report CLI surfaces.
7. Extend comparison dimensions without creating a universal score.
8. Add unit, migration, security, ledger, no-baseline, comparison, and deterministic end-to-end tests.
9. Run the privacy test repeatedly, then lint, typecheck, build, tests, and manual CLI checks.
10. Stop before hybrid retrieval, embeddings, memory learning, or adaptive delivery.
