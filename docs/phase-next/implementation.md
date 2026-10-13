# Autonomous context recovery — implementation and validation

Date: 2026-10-12. Scope: existing local worktree of `AntiDynamic/Continuum`, branch `main`, starting commit `d5b1044`. Earlier uncommitted work was preserved. This stage adds durable task memory and a controlled continuation path; it does not replace native compaction.

## Implemented

Major implementation files:

| File | Responsibility |
|---|---|
| [task-memory.ts](../../packages/shared/src/task-memory.ts) | Evidence, memory, authority, and recovery contracts |
| [migrations.ts](../../packages/database/src/migrations.ts) | Migration 14 |
| [task-memory-repository.ts](../../packages/database/src/repositories/task-memory-repository.ts) | Atomic evidence, supersession, versioned memory, and checkpoints |
| [durable-memory.ts](../../packages/context-engine/src/session/durable-memory.ts) | Bounded recovery and original evidence retrieval |
| [assist-execution-service.ts](../../packages/codex-app-server/src/assist-execution-service.ts) | Persistent native-thread continuation, proactive delivery, and configuration guards |
| [client.ts](../../packages/codex-app-server/src/client.ts) | Current compaction lifecycle, resume configuration, and effective reasoning |
| [task-memory.ts CLI](../../apps/cli/src/commands/task-memory.ts) | Local inspection, corrections, checkpointing, and exports |
| [compiler-server.ts](../../packages/mcp-server/src/compiler-server.ts) | Memory MCP tools and bounded delivery |
| [recovery-benchmark.mjs](../../scripts/recovery-benchmark.mjs) | Offline setup, mocks, and explicitly approved A/B/C execution |
| [recovery-isolation.mjs](../../scripts/recovery-isolation.mjs) | Evaluator and recorder isolation |
| [recovery-report.mjs](../../scripts/recovery-report.mjs) | Honest comparisons and exclusions |

### Durable memory in the existing database

Migration **14** adds `task_evidence`, `task_memory`, `task_checkpoints`, and `codex_session_bindings`. Existing observation, indexing, context session, and usage tables remain the shared foundation. No additional database, external service, embedding service, or model summarization dependency was introduced.

Original user instructions are captured with the existing redaction policy. Memory assertions distinguish `user`, `observed`, and `agent_reported`. Typed entries cover objectives, requirements, constraints, decisions, completed/pending work, questions, failures, validation, next actions, and source references. Corrections explicitly reference the entry they supersede; earlier text and evidence survive. Agent tools cannot supersede user requirements or submit observed test results.

Source references point to persisted context versions. Host observations retain execution, turn, and item identifiers so an auditor can trace them to existing raw event records, subject to capture settings. Test command exit codes are execution evidence, not independent proof that a task is correct. Unrecorded progress remains unknown.

Evidence/assertion writes and checkpoint writes use SQLite transactions. Checkpoints store a memory version, repository snapshot, active entry references, exact rendered recovery, and pending/delivered status. They do not duplicate the entire evidence archive. A changed memory version rejects an outdated checkpoint; interrupted writes roll back; repeated boundary keys return the original checkpoint.

The migration is forward-only. Migration failures roll back the current migration using the existing database migrator. No destructive automatic downgrade or deletion of original evidence is implemented.

### Bounded recovery and retrieval

`DurableTaskMemory` constructs a deterministic recovery packet from original evidence and structured entries. Critical state, the latest observed validation, and the latest recorded next action take priority over optional source/background references. The complete rendered text is estimated and bounded. Essential overflow reports omitted entry IDs and incomplete recovery; durable execution refuses to start substantive work with that packet.

The estimator is character-based. These numbers are **not provider-reported tokens**. MCP transport metadata and host prompt/tool framing are separate from the rendered payload estimate.

Recovery reads the actual repository snapshot without running a new index. Snapshot-bound observations become historical after a repository change. This is conservative: an unrelated file change can mark an observation historical. User requirements are not invalidated merely because code changes.

Evidence retrieval supports an exact evidence ID, memory kind, or case-insensitive text fragment, and returns a bounded response. Missing evidence is explicit. Exact source versions can be recovered through their references. This is deterministic retrieval, not a proven semantic memory system.

### Codex continuation

The existing assist execution service now supports persistent sessions. A binding preserves the native Codex thread, model, reasoning, permissions, and context/tool configuration. On continuation it resumes that thread, checkpoints current memory, injects bounded recovery through `turn/start`, and then permits generation. Model/provider/effective-reasoning drift is rejected before a generation turn. Rejected or interrupted executions retain recovery state.

Durable sessions keep native compaction configuration. Current `contextCompaction` item lifecycle events and the legacy notification are recognized. Completed compaction marks delivered source context evicted and records a checkpoint. Requirements are restored proactively at the **next runner-controlled turn boundary**. The runner does not claim an ordering guarantee for injection during an already active native turn.

The agent can request original evidence and record agent-reported progress through dynamic tools. Source delivery continues using the existing repository engine. Recovery does not depend exclusively on the agent choosing to retrieve its original requirements.

## Host capabilities and evidence

Installed CLI: **0.162.1**. Existing version-specific dynamic tool adapter: **0.133.0**; current fields were checked against generated 0.162.1 schemas. A real, isolated app-server successfully completed `initialize` and `account/read` without creating a thread or performing inference. Its isolated home contained no credentials during this probe.

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server) describes thread resume, explicit compaction, compaction item events, and persisted dynamic tools. Dynamic tools remain experimental. Local generated schemas confirm request fields for thread start/resume, turn effort, and compact start. Metadata and schema checks do not establish that a real model will execute this workflow successfully.

The [model inspection](model-inspection.json) advertises **`gpt-5.6-luna`**, supports **`low`** reasoning, and reports authenticated ChatGPT account metadata. It requested no inference. Account quota, real turn acceptance, monetary pricing, and credit conversion remain unverified.

Confirmed offline: storage, render bounds, checkpoint consistency, RPC framing, both compaction signal formats, configuration rejection, fresh-process memory recovery, and mocked native-thread continuation. Unverified live: actual compaction followed by successful agent continuation, real autonomous evidence use, and performance/cost improvement.

## Trustworthy evaluation infrastructure

`recovery-benchmark.mjs` prepares A/B/C using the same source fixture commit, original task, continuation, model, reasoning, permissions, timeouts, and token ceiling:

- **A:** native thread continuation, without Continuum context tools or injection.
- **B:** native continuation with repository retrieval and initial source context.
- **C:** retrieval plus durable memory and automatic recovery.

All use the native compaction prompt in this harness. Treatment differences are recorded. Independent invocations produce the same fixture commit using fixed evaluation commit metadata. Treatment order is shuffled during offline preparation; repetition IDs permit explicitly scheduled later trials.

Six development cases cover authentication/compatibility, cross-file contracts, migration rollback, cache debugging, a changed timeout requirement, and a late API constraint. Every prepared baseline fails an independent executable validator. Configuration correction asserts the new value; the API validator checks asynchronous behavior even if the agent rewrites its interface. These are development fixtures, not unseen realistic production tasks or proof of long-running effectiveness.

Linux evaluation uses existing Bubblewrap to hide the evaluator repository, host temporary artifacts, recorder database, and existing Codex history. Only the fixture workspace and an isolated native Codex home are exposed for writing. Local probes check evaluator/temporary-file invisibility and executable startup. The comparison harness fails closed if this isolation cannot be prepared. Live runs would copy required authentication into the temporary isolated home; those credentials are not exported with reports or copied databases. Production CLI integration does not automatically apply this evaluation isolation.

This is a tested filesystem boundary for the known local evaluation paths, not a universal security guarantee against a malicious, network-enabled program. Real nested Codex sandbox execution still requires the approved smoke test.

The harness distinguishes restart from explicit native compaction. Compaction evidence retains thread/turn/item identifiers and labels mock events separately. Mocks never produce genuine compaction counts. The reporting module excludes mocks/dry runs, rejects duplicate or mismatched cells and non-behavioral verification, and leaves missing usage/cost unknown. `decisionReady` remains false.

Model-call counts are not inferred from the number of turns. Recovery payload estimates are separate from provider input usage. Full compaction usage, critical-requirement retention as agent behavior, exact evidence use, repeated exploration, and attributable monetary cost remain unavailable unless independently measured. Reported accumulated thread usage is not summed across resumed turns, which would double-count history.

## Commands

```bash
# Offline only
pnpm test:recovery
pnpm benchmark:recovery --dry-run --output /tmp/continuum-recovery-dry
pnpm benchmark:recovery --mock --case authentication-compatibility \
  --transition compaction --output /tmp/continuum-recovery-mock
node scripts/recovery-report.mjs /tmp/continuum-recovery-mock

# Read/write original memory and export recovery without invoking a model
continuum session memory <session-id>
continuum session memory <session-id> --kind constraint --text "Preserve compatibility"
continuum session memory <session-id> --kind constraint --text "Updated constraint" --supersedes <entry-id>
continuum session memory <session-id> --recover --budget 1500
continuum session memory <session-id> --checkpoint restart-1
continuum session memory <session-id> --query <evidence-id>
```

The normal `pnpm test` command explicitly disables live Codex tests. Benchmark generation requires both `--run` and `--approved-live`, and explicitly selects one case and treatment. It never launches the entire paid suite. Output directories containing a report are rejected to preserve earlier evidence.

Paid CLI use, **only after approval**:

```bash
continuum codex run "<task>" --mode assist --durable-memory \
  --model gpt-5.6-luna --reasoning-effort low --timeout 60s --json
continuum codex run "<continuation>" --mode assist --durable-memory \
  --resume-session <session-id> --model gpt-5.6-luna \
  --reasoning-effort low --timeout 60s --json
```

`--supersedes-memory <entry-id>` makes a continuation an explicit user correction. MCP exposes durable recovery, original evidence retrieval, and agent-reported memory recording. The normal agent response uses rendered content; diagnostic structured receipts require `CONTINUUM_MCP_AUDIT=1`.

## Validation record

Build, typecheck, lint, frozen install, and the test suite pass: **227 workspace tests plus 39 script tests, 266 passed, zero failed, four provider tests skipped**. This phase introduces 23 memory/recovery regressions, six comparison regressions, and one MCP regression.

See [validation.json](validation.json), [offline-demo.json](offline-demo.json), and [benchmark-evidence.json](benchmark-evidence.json). The demonstration writes an original requirement and retrieves it through a fresh CLI process against real SQLite; evidence identity and rendered hashes remain traceable. It is a persistence demonstration, not agent behavior evidence.

The regressions cover the requested persistence, supersession, constraint recovery, missing/overflow/stale data, failed validation, idempotence, correct-session selection, interrupted/concurrent writes, budgets, provenance, redaction, fresh processes, protocol events, model configuration, and evaluation honesty. Additional checks catch a rewritten synchronous API interface, contradictory success labels, and partial MCP delivery regression.

## Remaining limitations

- No real model-driven benchmark, real compaction, or successful real-agent continuation was run.
- Automatic recovery happens at a controlled continuation boundary, not immediately inside an ongoing native turn. No claim that MCP controls Codex's internal window.
- Native thread resume and restored dynamic tool use are documented and mocked, not yet live-qualified.
- Reported token ceilings are reactive. A provider may exceed the ceiling before emitting usage; timeouts are not hard monetary caps. Missing usage stops further live operations.
- The existing cumulative repository source-delivery allowance remains 8,000 estimated tokens in assist sessions. Durable recovery has a separate per-packet budget. Long-run source budget renewal is not implemented.
- Progress/decisions not observed or recorded remain unknown. New user instructions are retained conservatively; automatic semantic reconciliation is not implemented. Corrections need explicit supersession.
- Snapshot freshness is conservative, redaction is best effort, and excluded secrets are intentionally not preserved as ordinary memory.
- Four earlier controlled retrieval misses remain open. Historical pattern-only benchmark success labels remain unsuitable for effectiveness claims.
- No causal token reduction, savings, better understanding, or zero information loss is established.

## Credit accounting and next approval

**Live model-driven benchmark treatment runs: 0.** No secondary development agents were launched. Validation used local computation, mock processes, version/schema inspection, and metadata requests. No benchmark provider inference usage or attributable bill was reported; monetary testing cost is therefore not represented as measured zero. This conversation's development model/billing are controlled by the host and are not exposed by repository instrumentation; verifying Luna did not switch this chat's model.

Proposed first live experiment: **one C treatment, two generation turns, one explicit compaction request**, `gpt-5.6-luna`, `low`, on `authentication-compatibility`. This establishes whether the isolated real host can execute, compact, resume the same thread, receive recovery, and satisfy independent behavior checks. It cannot establish comparative savings.

Planning estimate: up to **30,000 input and 4,000 output tokens** across the experiment; this is an estimate, not an enforceable billing maximum. Cached/reasoning/compaction usage and ChatGPT credit conversion are unknown. There is no defensible monetary quote.

Limits: two turn-start requests, one compact-start request, 60 seconds per generation turn, 30 seconds for compaction, and a 20,000 reported-thread-token stopping threshold. Stop on unavailable model/authentication, model/provider/reasoning drift, missing first-turn usage, token threshold, timeout, failed first turn, or absent compaction completion evidence. No automatic retries or model substitutions. Provider-internal model calls can exceed runner request counts.

Exact proposed command, **not executed**:

```bash
pnpm benchmark:recovery --run --approved-live --treatment C \
  --case authentication-compatibility --transition compaction \
  --timeout-ms 60000 --token-ceiling 20000 \
  --output /tmp/continuum-recovery-live-c-1
```

After reviewing that smoke test, a separately approved A/B/C pilot would use three treatment runs (six generation turns and up to three compactions). Repetitions and held-out tasks are later gates, not included in this approval request.
