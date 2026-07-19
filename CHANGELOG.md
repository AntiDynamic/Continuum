# Changelog

## Unreleased

- Added Phase 3D budgeted packet sections with a hard normal ceiling, mandatory reserves, metadata-only escalation, oversized-item reporting, and symbol/file containment suppression.
- Added explicit coverage states, deterministic test discovery and identifier normalization, bounded retrieval hydration, stage latency profiles, real packet composition evidence, and adversarial regressions.
- Passed the unchanged native-integration retrieval gate without adding native execution, provider APIs, embeddings, LLM reranking, memory, compaction, experiments, dashboards, or publishing.
- Added deterministic context compilation with contextual headers, provenance, purpose evidence, and version hashes.
- Added TypeScript Compiler API v2, coherent Markdown, nested JSON/YAML, and statement-level SQL extraction.
- Added explainable task analysis, risk-aware coverage, hybrid retrieval, bounded graph expansion, diversity selection, and budget-constrained packets.
- Added explicit-ID FTS5 storage, fallback lexical scoring, relationship evidence, and append-only retrieval evidence.
- Added engine-backed CLI context commands and structured MCP tools.

- Added production progressive-context session integration across CLI and MCP with one repository-scoped application service.
- Added idempotent initial delivery, strict signal schemas, persisted session reports, run-report evidence, and real CLI/MCP stdio integration coverage.

- Added Phase 3C standalone child-process acceptance, adversarial CLI coverage, and cross-process CLI/MCP verification.
- Added a versioned 24-case deterministic retrieval benchmark, component ablations, controlled fixtures, real-repository evaluation, stable JSON evidence, and a documented no-go decision.
- Fixed initialized-but-unindexed session remediation to direct users to continuum index.

- Added Phase 4A native Codex App Server shadow integration with generated stable 0.133.0 protocol schemas, real stdio JSONL transport, authenticated thread/turn lifecycle, append-only Flight Recorder ledgers, persisted reports, safe approval handling, and explicit experimental API opt-in.
- Added fixture protocol, CLI shadow, failure-path, and genuine isolated live-Codex smoke coverage. Shadow observation does not inject predicted context or claim provider savings.

## Phase 4A.1 — Shadow Flight Recorder Evidence Integrity Patch

- **Breaking (schema v2):** `report.schemaVersion` changes from `continuum.shadow-flight-recorder.v1` to `continuum.shadow-flight-recorder.v2`. All v1 fields are preserved as deprecated aliases.
- **Fixed — evidence model:** Exploration evidence now separates `editedPaths` (Codex file changes) from `commandInferredReadPaths` (shell argument inference) from `searchedPaths` and `searchedSymbols`. `directlyObservedReadPaths` is always empty and documented as such — the Codex App Server schema v0.133.0 does not expose direct file-read events.
- **Fixed — requirement states:** `prediction.items[i].mandatory` is now `true` only when the coverage requirement state is `"required"`. Previously all items were `mandatory: true`. The new `requirementState` field exposes the exact value.
- **Fixed — comparison metrics:** `observationRecall` = overlap / |observed|; `predictionPrecision` = overlap / |predicted|. Previously these were swapped and labelled incorrectly.
- **Fixed — snapshot integrity:** Failed-run final snapshot now preserves the starting session snapshot rather than fabricating a database integer as a commit hash.
- **Fixed — searched symbols:** `searchedSymbols` is now populated from rg/grep command inferences rather than always being an empty array.
- **Fixed — live smoke model:** Live smoke test no longer hardcodes `gpt-5.5`; uses `CONTINUUM_CODEX_LIVE_MODEL` env var or Codex default.
- **Added — `.continuumignore`:** Created root `.continuumignore` excluding `packages/codex-app-server/schema/**` and benchmark result snapshots from the Continuum index.
- **Added — correctness tests:** `packages/codex-app-server/tests/flight-recorder-correctness.test.ts` (12 tests) and `packages/repository-indexer/tests/continuumignore.test.ts` (6 tests) prove all hardened behaviors.
- **Added — CLI display:** `continuum codex` now shows `observationRecall`, `predictionPrecision`, mandatory item count, edited file count, inferred read count, and searched symbol count.
- **Updated — docs:** `docs/shadow-flight-recorder.md` documents the v2 schema, evidence model, metric formulas, and snapshot integrity contract.
