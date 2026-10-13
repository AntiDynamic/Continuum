# First real Treatment C smoke: failed, no restart

One genuine Codex experiment was attempted with `gpt-5.6-luna`, provider `openai`, and `low` reasoning. These values were confirmed by the actual `thread/start` response. Native retries were explicitly accepted for this experiment. The external GNU timeout watchdog, isolated workspace and exclusive experiment lock were active.

## Result

- **One generation turn requested and acknowledged. Two model responses have native response-ID usage records.** The turn did not complete.
- The isolated runtime omitted `codex-code-mode-host`. Both observed `exec` tool attempts failed to launch that helper. No code observation or change completed.
- Reported thread usage grew from **12,961** to **26,052** tokens. The 20,000-token guard stopped further work. This threshold cannot prevent one response from taking usage above the threshold.
- A cancellation-path unhandled promise rejection then exited the Node runner before normal lifecycle/report cleanup. The raw trace and native rollouts survived. No matching isolated host process remained during the postmortem check.
- **No compaction and no second generation turn were requested.** Native compaction recovery and same-thread continuation remain untested.
- Original user requirements and source references persist in SQLite, with one initial durable checkpoint. Initial-turn recovery content was delivered, but that is not evidence of recovery after compaction.
- All 12 fixture source files are unchanged. Offline post-failure validation fails: the independent hidden authentication check still finds that empty-token rejection is missing. The visible validator also fails on an unrelated cache-timeout fixture defect, exposing a scope problem in that success gate.

## Reported usage and execution counts

| Measurement | Observed |
|---|---:|
| Input tokens, including cached input | 25,807 |
| Cached input tokens (subset of input) | 12,032 |
| Output tokens | 245 |
| Total reported thread tokens | 26,052 |
| Live experiments / logical generation turns / explicit compactions | 1 / 1 / 0 |
| Continuum-controlled retries / automatic restarts | 0 / 0 |
| Completed model response records | 2 |
| Observable provider retry notifications | 0 |
| Failed tool-host launch attempts | 2 |

Internal provider retry totals and final billing are unavailable. Two model responses within one logical turn do not constitute two planned generation turns. Two failed tool attempts are not proof of a provider transport retry.

The recorded run interval is **21.021 seconds**, from log creation to its final error write. The recorded generation interval is **7.560 seconds**. Exact whole-process exit wall time was not emitted by the crashed runner. No monetary cost or guaranteed spending cap is claimed.

## Evidence integrity and fixes

`report.json` is a **postmortem reconstructed from preserved evidence**, not the runner's normal completion report. The original database still labels the execution `running` and session `active`, because the crash skipped cleanup; those are stale lifecycle values, not proof of a live process. The final usage update was captured in the protocol trace and native token records before the guard failed, but was not normalized into the recorder database. The database's earlier usage snapshot must not be mistaken for the final reported total.

The pending-request rejection defect was fixed offline by attaching a rejection handler before the raw-event write can fail. The new interruption regression and all eight client tests pass; package build, typecheck and lint pass. The interrupted experiment was not resumed or rerun. This fix prevents the demonstrated unhandled rejection; it does not prove graceful provider-side cancellation or complete billing accounting.

Before any separately approved future live test, the isolated tool runtime needs its required helper binaries and an actual non-inference tool-runtime preflight. The visible authentication validation gate also needs its unrelated cache check separated. Neither increasing the token threshold nor launching another benchmark was performed.

## Preserved artifacts

- `authentication-compatibility-C-trace.jsonl`: real App Server traffic and safety events.
- `native-rollouts/`: native session history, response IDs, failed tool outputs and token records, using existing redaction.
- `database-original/` and `authentication-compatibility-C.db`: original SQLite/sidecars and a consistent backup.
- `task_*.json`, `context_sessions.json`, `codex_executions.json`, `codex_usage_snapshots.json`: original recorded state.
- `original-fixture/`, `final-fixture/`: source versions and fixture Git identity.
- `configuration.json`, `authorization.json`, `model-inspection.json`: model, permissions, watchdog, isolation and explicit retry exception.
- `runner.log`: original uncaught error.
- `independent-validation.json`: offline post-failure behavioral checks.
- `implementation-source/`: exact pre-run implementation; `client-after-offline-fix.ts`: subsequent local fix.
- `offline-stop-fix-*.log`: regression, build, typecheck and lint results.
- `evidence-sha256.json`: artifact hashes.

Authentication credentials are excluded from exported evidence. This failed smoke test provides no evidence that Continuum outperforms native compaction or reduces cost.
