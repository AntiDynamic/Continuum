# Audit implementation — 2026-10-12

This is the implementation follow-up to the [repository audit](../repository-audit-2026-10-12.md). The original findings and results describe the earlier worktree; they are retained as historical evidence.

## Changes

- Retired the unused implementation paths, duplicate generated tests, placeholder assertions, and unused dependencies identified in the audit.
- Replaced source-pattern acceptance with executable TypeScript behavior checks and real SQLite migration/rollback checks. Verified success now requires both behavioral validators. Effectiveness fixtures are checked for an initially failing baseline before an agent runs. The synthetic authentication fixture defines the literal `expired` as its expired-token representation; this is a fixture contract, not a general authentication implementation.
- Added session snapshot epochs, automatic refresh after edits, checkpoint/restoration support, and durable execution observations for recovery. Changed items expire; unchanged versions keep their identity. Refresh currently scans the repository again.
- Persisted the exact rendered delivery and its hash, decision, omissions, and estimated token charge. Handoff and MCP use that canonical text. An impossibly small budget fails explicitly. Token counts remain character-based estimates, not provider tokenizer measurements.
- Corrected empty/missing required coverage, test versus implementation classification, configuration source spans, task vocabulary normalization, package discovery, and TypeScript import-binding relationships. Graph and coverage ablations now disable the corresponding engine behavior and rerun retrieval.
- Isolated comparison arms in separately indexed worktrees, added an optional preparation command, and retained completed and failed arm databases and reports outside those worktrees.
- Added explicit nullable provider usage and pricing contracts, aggregation across OpenCode steps, pure-preflight comparisons, correct matched-pair accounting, and median bootstrap intervals. Unknown cost remains unknown; historical regex-only results cannot count as behavioral successes.
- Corrected OpenCode's named MCP configuration and added a host discovery check. Persisted provider/test output honors capture and redaction settings. Updated redaction for modern OpenAI key formats.
- Fixed adapter exception finalization, test-summary counting, Git porcelain path parsing, concurrent SQLite startup waits, Node's minimum version, runtime dependencies, and the pnpm pin. Live Codex tests now require an explicit opt-in.

## Verification

`pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass. The workspace has 226 passing tests and four skipped provider tests; the additional script suite has 10 passing regression tests. No live provider benchmark was run.

The [post-implementation reproductions](results-after-implementation-2026-10-12.json) confirm:

- The handoff, delivery, and persisted budget all charge 622 estimated tokens against a 1,500-token ceiling; a one-token request is rejected.
- A source edit refreshes subsequent session requests and searches.
- Empty required coverage is incomplete.
- The forged incorrect implementation fails both behavioral validators.
- The synthetic secret is removed before raw-event persistence.
- A throwing adapter leaves a failed run, rather than a running run.
- Comparison initialization succeeds; two OpenCode steps sum to 300 input tokens; unavailable pricing stays null; the test parser counts 10 tests rather than two files.

Reproduce without provider calls:

```bash
pnpm build
pnpm test
CONTINUUM_LOG_LEVEL=error node docs/audit/reproduce.mjs
node scripts/retrieval-benchmark.mjs --output /tmp/continuum-retrieval.json
```

## Remaining qualification work

The [24-case retrieval run](retrieval-after-implementation-2026-10-12.json) reports 0.9333 recall at ten, 0.9861 mandatory coverage recall, zero repeated full-content resends across three repeat requests, and a maximum initial packet of 1,134 estimated tokens. Four cases still miss required context: API route tests, SQL migration tests, a configuration loader mentioned indirectly in documentation, and ambiguous timeout context. These misses are recorded, not waived. The fixtures are a development benchmark and do not establish general performance.

Provider cache handles, actual cache hits, causal cost savings, and effectiveness on held-out repositories are not established by these offline checks. The stable prefix is ordered for reuse, but this does not prove provider caching. The evaluator runs outside the agent workspace but is not an operating-system security boundary against a malicious agent. Namespace imports, re-exports, and workspace resolution need broader graph qualification. The legacy run-credit interface also predates the newer provider usage semantics; use the explicit provider contract for effectiveness billing conclusions.

Completed and failed comparison arms have persisted reports and copied databases, including a regression check for unexpected process exit. The remaining requirements above are release qualifications; `decisionReady` remains false.

MCP normally returns canonical model-visible text. Set `CONTINUUM_MCP_AUDIT=1` only for diagnostic consumers that need the full structured receipt. New session CLI operations are `session refresh` and `session checkpoint`; requests also refresh automatically after edits.
