# Continuum Observer Implementation Plan

# Continuum Observer Implementation Plan

## V1.1.2 Evidence Integrity Patch (Phase A)

**Existing V1 strengths:**
- Strong orchestration and state machine.
- Git snapshots and evaluator metrics work well.
- Node SQLite migration successful and performant.

**Remaining V1 evidence gaps:**
- `packages/gemini-adapter/src/parser.ts` stores unredacted `tool_call` inputs when `captureRawOutput: false`.
- `parseStderrLine` ignores `captureRawOutput: false` and always persists stderr lines.
- `adapter-contract.test.ts` only checks for `run_completed`, failing to acknowledge `run_failed` as a valid terminal event.
- CLI integration tests lack a valid successful workflow with a fake agent and temporary Git repository.
- `continuum compare` tests need to verify multiple runs effectively.
- Smoke tests are overloaded (transport verification mixed with success verification).

**Tests required:**
- Improved `defineAgentAdapterContract` with exact terminal event checks, redaction tests, and `captureRawOutput` variations.
- Successful fake CLI integration workflow (init, run, report, outcome).
- End-to-end database privacy test with sentinel secrets.
- Two separate smoke tests: `test:gemini-transport` and `test:gemini-success`.

## Continuum V2 (Phase B)

**Reusable architecture for V2:**
- Existing `DatabaseSync` setup is robust for adding FTS tables.
- `GitAnalyzer` provides a solid foundation for repository reading.
- CLI infrastructure easily accommodates new `continuum index`, `context`, and `mcp` commands.

**Schema changes required:**
- Add tables: `repository_index_runs`, `indexed_files`, `context_items`, `context_item_links`, `context_retrievals`, `context_retrieval_items`.
- Use SQLite FTS5 for text search.
- Ensure V1 `agent_runs` can link to `context_retrievals`.

**Backward compatibility risks:**
- Database migrations must not break existing V1 run records.
- Storing `tool_call` inputs must remain compatible with V1 evaluation structures.
