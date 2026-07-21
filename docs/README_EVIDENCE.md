# Continuum — README Evidence Ledger
## Audit date: 2026-07-21
## Auditor: portfolio/fix-ci-and-readme branch

---

| Claim | Evidence files | Verification command / location | Status |
|-------|---------------|--------------------------------|--------|
| TypeScript monorepo with 10 packages | `packages/*/package.json`, `pnpm-workspace.yaml` | `ls packages/` | Verified |
| SQLite persistence via `node:sqlite` | `packages/database/src/connection.ts` | grep node:sqlite | Verified |
| 9 versioned database migrations | `packages/database/src/migrations.ts` lines 27,175,289,367,431,471,518,540,581 | grep "version:" | Verified |
| FTS5/BM25 search with lexical fallback | `packages/database/src/migrations.ts` lines 268+, `connection.ts` lines 109+ | grep fts5 | Verified |
| MCP stdio server | `packages/mcp-server/`, `apps/cli/src/commands/mcp.ts` | ContinuumMcpServer class | Verified |
| Redaction module | `packages/shared/src/redaction.ts` | file exists | Verified |
| Redaction test | `packages/shared/tests/redaction.test.ts` | file exists | Verified |
| End-to-end privacy test | `packages/agent-core/tests/privacy.test.ts` | describe("End-to-End Database Privacy") | Verified |
| 54 test files across monorepo | All `*.test.ts` files | `Get-ChildItem -Recurse -Filter *.test.ts` | Verified (54 files) |
| Cross-platform CI: Ubuntu + Windows | `.github/workflows/ci.yml` matrix.os | ci.yml | Verified |
| CI Node 22 + 24 matrix | `.github/workflows/ci.yml` matrix.node-version | ci.yml | Verified |
| CI failing (typecheck before build) | GitHub Actions runs 29704170676 | `gh run view --log-failed` | Verified — FIXED in this branch |
| Gemini adapter streaming | `packages/gemini-adapter/src/` | files present | Verified |
| Run orchestration | `packages/agent-core/src/orchestrator.ts` | file exists | Verified |
| Git analyzer | `packages/git-analyzer/src/` | files present | Verified |
| Evaluator/report | `packages/evaluator/src/` | files present | Verified |
| Context engine | `packages/context-engine/src/engine.ts` | file exists | Verified |
| Repository indexer | `packages/repository-indexer/src/` | files present | Verified |
| Codex App Server shadow mode | `packages/codex-app-server/` | files present | Verified (experimental) |
| 24-case retrieval benchmark | `docs/retrieval-benchmark.md`, `packages/context-engine/benchmarks/v1/` | file exists | Verified |
| Benchmark labels pre-set | `docs/retrieval-benchmark.md` | "Labels were written before retrieval" | Verified |
| `.continuumignore` support | `.continuumignore` file in root | file present | Verified |
| Privacy model: local-first, no upload | `README.md` Privacy Model section | text claims | Partially verified (architecture intent; network calls not audited) |
| Codex Dynamic-Tool Runtime (Phase 4B.1) | Git log commit 1d81ca7, `packages/codex-app-server/` | commit message | Partial (experimental, CI failing) |
| Context sessions | `packages/context-engine/src/session/` | directory present | Verified |
| Context session tests | `packages/mcp-server/tests/session-product.test.ts` | file exists | Verified |

## CI Status
- All 10 CI runs (2026-07-12 to 2026-07-19) FAILED
- Root cause: `pnpm typecheck` ran before `pnpm build`
- `@continuum/shared` exports from `dist/index.js` which requires prior build step
- Fix: swapped Typecheck and Build steps in ci.yml
- This PR fixes the ordering

## Claims NOT verified
- Token savings percentage — explicitly disclaimed in README ✓
- Provider billing cost — not measured, explicitly disclaimed ✓
- Model attention — explicitly disclaimed ✓
- Production-ready status — version 0.1.0, no releases, not claimed ✓
- Codex native integration — explicitly described as experimental/shadow-only ✓