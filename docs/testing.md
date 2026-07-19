# Testing Continuum

Run the complete workspace gates:

    pnpm lint
    pnpm typecheck
    pnpm build
    pnpm test
    git diff --check

Run standalone CLI/MCP acceptance independently with:

    pnpm test:acceptance

The CLI harness creates fresh temporary Git repositories and invokes the built CLI in separate child processes. It covers initialization, indexing, session persistence, idempotent initial context, exact and repeated requests, signals, persisted reporting, lifecycle failures, repository isolation, malformed input, dirty-worktree changes, interrupted processes, concurrent reads, and SQLite integrity. The MCP fixture uses actual stdio JSON-RPC processes and verifies cross-interface persistence and stdout framing.

Run retrieval evaluations independently:

    pnpm benchmark:retrieval
    node scripts/retrieval-benchmark-real.mjs

Optional Gemini smoke tests remain separate because they require a local external CLI:

    pnpm test:gemini-smoke

Latency is local wall-clock retrieval latency. Packet tokens are deterministic estimates, not provider billing evidence.

## Codex App Server Phase 4A

Run the protocol fixture suite and full CLI fixture acceptance after building packages:

    pnpm --filter @continuum/codex-app-server test
    pnpm --filter @continuum/cli test tests/codex-shadow.test.ts

The tests spawn a real JSONL fixture process. They cover request correlation, out-of-order replies, stderr separation, malformed events, approvals, exit handling, append-only evidence, authentication failure, partial reports, and restart reconstruction.

Run the genuine installed-Codex smoke separately:

    pnpm --filter @continuum/codex-app-server test:live

It creates a disposable Git repository, uses `workspace-write` with approval policy `never`, requests a small local fix, and never runs against the Continuum working tree. Set `CONTINUUM_DISABLE_CODEX_LIVE=1` only to explicitly skip it; the test logs the exact skip reason.
