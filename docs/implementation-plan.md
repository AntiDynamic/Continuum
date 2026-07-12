# Continuum Observer Implementation Plan

## V1.1.1 Verification Hardening Pass (Current State)

**Confirmed gaps:**
- `apps/cli/tests/cli.test.ts` and `packages/shared/tests/adapter-contract.test.ts` contain placeholder tests (`expect(true).toBe(true)`).
- Secrets in the arguments array of the Gemini CLI run command are currently not redacted before storage.
- The `captureRawOutput: false` configuration does not strip raw events completely.
- Structured objects in agent events are not recursively redacted for secrets.
- Initialization timeout behaves generically, regardless of `stream-json`, `json`, or `text` mode.
- Output streams concurrency has no deterministic stress tests.
- Uses of `any` type (like `let child: any` and `AgentFailureKind`) weaken strictness.
- CI configuration exists but does not prove genuine multi-platform stability.

**Existing reusable code:**
- Core orchestrator state machine.
- Event tracking and usage metrics DB tables.
- `ParseContext` and `ParseStatus`.
- Redaction patterns array support.

**Tests that are real:**
- Database tests (`database.test.ts`).
- Git analyzer tests (`git.test.ts`).
- Evaluator report tests (`report.test.ts`).
- Config, utils, and redaction unit tests.
- Gemini adapter `parser.test.ts` and orchestrator `fake-adapter.test.ts`.

**Tests that are placeholders:**
- CLI integration tests (`cli.test.ts`).
- Adapter contract tests (`adapter-contract.test.ts`).

**Privacy risks:**
- `args` array persists unredacted secrets.
- `captureRawOutput: false` does not clear raw fields.
- Nested JSON secrets evade simple string redaction.

**Lifecycle risks:**
- `initializationTimeoutMs` applies indiscriminately to text/JSON output, risking valid slow-startup cancellation.

**Files to modify:**
- `docs/implementation-plan.md`
- `packages/shared/src/agent-adapter.ts` (RedactedCommand)
- `packages/shared/src/agent-events.ts` (Strict FailureKind)
- `packages/shared/src/redaction.ts` (Recursive redaction)
- `packages/gemini-adapter/src/gemini-adapter.ts` (Mode-aware initialization, proper execa types, arg redaction)
- `packages/agent-core/src/orchestrator.ts` (Raw output cleanup, orchestration strictness)
- `apps/cli/tests/cli.test.ts` (Integration tests)
- `packages/shared/tests/adapter-contract.test.ts` (Contract definitions)
- `.github/workflows/ci.yml` (Tighten CI steps)
- `README.md`, `docs/architecture.md`, `docs/metrics.md`, `docs/limitations.md` (Update claims and limitations)
