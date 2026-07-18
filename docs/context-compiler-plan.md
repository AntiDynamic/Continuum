# Continuum Context Compiler Assessment

## Existing extraction capabilities

- Repository discovery respects `.gitignore` and `.continuumignore` and classifies supported source files.
- TypeScript Compiler API extraction currently finds named functions, classes, class methods, interfaces, type aliases, variable statements, imports, exports, and common test declarations.
- Markdown extraction emits coherent top-level heading sections rather than individual paragraphs.
- JSON and YAML extraction emit top-level configuration sections.
- SQL extraction recognizes statement blocks for tables, indexes, views, and virtual tables.
- Snapshot identity and deterministic file/content hashing already exist.

## Existing retrieval capabilities

- Repository-scoped current-version search uses SQLite FTS5 when available and a LIKE fallback otherwise.
- Search terms are sanitized before FTS MATCH, malformed or empty queries return safely, and BM25 direction is converted so stronger matches have larger values.
- Shared ranking adds basic exact title/symbol, freshness, and length components.
- Shared packing enforces character and item limits.
- Prompt 1 adds deterministic token estimates, packet accounting, delivery stages, and duplicate-delivery suppression.

## Existing versioning guarantees

- Context items have stable repository-scoped logical identities and immutable versions.
- Equal content hashes do not create a new version.
- Inserting changed content atomically closes the prior open validity window.
- Default search excludes versions with a closed `valid_to_commit_exclusive` value.
- Dirty index runs persist a worktree hash and versions retain source blob hashes.
- Provenance is currently JSON text rather than a typed queryable contract.

## FTS5 implementation quality

- FTS5 availability is probed and unexpected database errors are rethrown.
- BM25 ordering direction is no longer destroyed with `Math.abs`.
- The virtual table stores only content, title, and symbol name.
- FTS rows are joined to versions through implicit SQLite rowid alignment; version ID, repository ID, source path, and contextual header are absent.
- FTS updates are insert-only and do not explicitly model superseded version lifecycle.
- No typed raw/normalized lexical score evidence is exposed.

## Fallback-search behavior

- The fallback is repository-scoped and excludes historical versions.
- It performs broad content/title/symbol LIKE matching.
- Every result receives the same arbitrary score, so exact symbol/path and token-overlap quality are lost.
- Source path, normalized token overlap, and deterministic score evidence are missing.

## Missing context relationships

- A `context_item_links` table exists but stores only source, target, relationship string, and creation time.
- Indexing does not populate reliable imports, exports, tests, configuration, containment, documentation, extends, or implements relationships.
- Confidence and source-line evidence are absent.
- No bounded graph expansion service exists.

## Missing task classification

- Queries are treated as unstructured text.
- Explicit paths, symbols, packages, likely languages, task class, risk, complexity, and classification reasons are not extracted.
- No configurable task-class coverage policy exists.

## Missing security controls

- Repository constraints are not distinguished from agent or system instructions.
- Authoritative constraint sources and headings are not classified or stored.
- MCP accepts a relative path and resolves it without a containment check, creating a filesystem-escape risk even though it only opens Continuum databases.
- Retrieval does not require security/privacy coverage for sensitive tasks.

## Missing coverage logic

- Packets do not model implementation, contracts, tests, configuration, architecture, security, schema, rollback, dependency, documentation, or repository-state coverage.
- Mandatory coverage can be omitted silently when a character budget is exhausted.
- Missing coverage and additional required budget are not reported.

## Current ranking weaknesses

- Ranking is duplicated through callers in CLI and MCP and lives in the shared domain package.
- Exact path/package evidence, contextual headers, relationships, task class, risk coverage, snapshot state, uncommitted state, historical state, token cost, and duplicate penalties are absent.
- Only a scalar plus generic component list is returned; human-readable reasons and coverage categories are missing.
- FTS scores are not normalized to a stable bounded range.

## Current packet-building weaknesses

- Packing uses characters rather than the Prompt 1 token-estimator contract.
- The first oversized item may exceed the total budget.
- Orientation, implementation, and metadata-only escalation sections are not separated.
- There is no diversity limit per file or symbol family and no safe-boundary truncation evidence.
- Coverage, omission reasons, strategy version, snapshot identity, and completeness are absent.

## Schema changes required

- Add typed compiled-item fields for contextual header, compiled content, purpose evidence, and structured metadata/provenance.
- Replace rowid-coupled FTS storage with explicit version and repository identifiers plus title, symbol, path, header, and content fields.
- Extend relationship persistence with kind, confidence, evidence, and version-aware endpoints.
- Extend retrieval evidence with task analysis, backend, raw/normalized lexical scores, boosts, penalties, inclusion decision, omission reason, packet section, estimated tokens, and strategy version.
- Preserve existing tables and append a new migration; do not rewrite historical evidence.

## Backward-compatibility risks

- Existing databases need FTS backfill without losing context versions.
- `rankResults` and `packContext` imports from `@continuum/shared` need temporary compatibility re-exports while CLI and MCP move to `@continuum/context-engine`.
- Existing `retrieve_context` MCP clients need an alias while structured tools are added.
- Existing context search/pack syntax and Prompt 1 ledger behavior must continue to work.
- Configuration schema version 1 must accept the new disabled semantic defaults without invalidating existing config files.

## Required implementation sequence

1. Add shared compiler, relationship, task-analysis, coverage, scoring, and packet domain contracts.
2. Strengthen extractor metadata and implement deterministic contextual compilation in repository-indexer.
3. Append database migration and typed repositories for compiled fields, explicit FTS identity, relationships, and retrieval evidence.
4. Create `@continuum/context-engine` with task analysis, coverage policy, lexical/exact retrieval, optional semantic boundary, bounded graph expansion, reranking, diversity, and budget-aware packets.
5. Route indexing through the compiler and route CLI/MCP retrieval only through context-engine.
6. Add deterministic benchmark fixtures and focused compiler, retrieval, ranking, coverage, diversity, CLI, and MCP tests.
7. Document behavior and limitations, run all focused and workspace gates, then execute manual fixture checks.
