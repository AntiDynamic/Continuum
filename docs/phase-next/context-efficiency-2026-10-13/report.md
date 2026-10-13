# Context efficiency audit and third real recovery smoke

## Findings

**Recovery transport and fixture behavior are verified. The experiment failed its provider-budget qualification. Comparative benefit remains unverified.**

One authorized live experiment ran, with `gpt-5.6-luna`, `openai`, `low`, Treatment C and `on_demand`. Native protocol confirms both generation turns and one genuine compaction completed on thread `01a131fb-890d-7f62-beeb-299a567f3991`. Continuum supplied the original persisted requirement in the continuation, before substantive work. Independent visible and hidden authentication validators pass. No agent output was repaired afterward.

The reactive threshold was crossed at the second turn's completion. The runner recorded failure and requested interruption; native `turn/completed` nevertheless reports **completed**, not interrupted. These observations coexist: native completion and a failed benchmark control outcome. The original report.json is retained unchanged.

## Readiness and validation

| Gate | Offline preflight | Actual experiment |
|---|---|---|
| Initial-packet measurement | PASS | on_demand: no extra initial envelope |
| Three strategies | PASS | only on_demand tested live |
| Usage ledger | PASS for historical generation records | Compaction omission discovered; corrected full ledger preserved |
| Native compaction protocol | PASS mocked lifecycle | VERIFIED request, contextCompaction event and native compacted record |
| Recovery injection | PASS replay and fresh-process recovery | VERIFIED exact payload receipt on same thread |
| Validator integrity | PASS baseline/correct/counterfeit/expiry regressions | Visible and hidden PASS |
| Model/provider/reasoning lock | PASS | Three native effective-configuration observations agree |
| Retry safeguards | PASS | Zero Continuum retries; no host retry events observed; internal count unavailable |
| Cancellation | PASS | Interrupt requested at completion; all three app-server processes exited normally |
| Isolation | PASS actual helper and sandbox command | Hidden validator/recorder/history protections applied |
| Provider usage budget | Calibrated planning range, fixed 85k threshold | **FAIL: native thread notifications excluded compaction consumption** |
| Operation limits | PASS | Exactly two turns, one compaction, no restart |

Build, typecheck and lint passed. Full suite: **310 passed, zero failed, four provider tests skipped**. Final pre-inference targeted gates: **38 passed**; cancellation regression: **five passed**. After the live accounting defect was found, **24 affected accounting/guard tests passed**. These counts describe separate executions and must not be summed as unique tests. A subsequent dry run used no inference. The full suite was not repeated after post-live corrections. Final build/typecheck/lint and affected-package checks passed; nine final strategy/snapshot regressions and 26 final accounting/audit/guard tests passed.

## Timeline (UTC, 2026-10-12)

1. 21:18:51.155: effective native model/provider/reasoning confirmed.
2. 21:18:51.220: first generation begins with original task only; no preloaded repository envelope.
3. 21:18:54.552: first turn completes acknowledgement; no tool work or source edits.
4. 21:18:54.985: explicit thread/compact/start requested.
5. 21:18:58.561: native compaction response usage recorded.
6. 21:18:58.564: native compacted record stores replacement history, window 1 and compaction response identity.
7. 21:18:58.575: item/completed contextCompaction received; native compaction turn later completes.
8. SQLite recovery constructed; complete original requirement retained with evidence references.
9. 21:18:59.441: second turn starts on the same thread with the recovery input; native userMessage records its exact receipt before tool work.
10. Agent explores source, changes only src/auth-service.ts, performs behavioral checks and emits its final answer.
11. 21:19:38.034: host notification reaches 92,910 thread tokens; runner requests interruption and records failure.
12. 21:19:38.040: native second turn/completed reports completed; process exits normally.
13. Independent validation after termination: visible PASS, hidden PASS. No source repair.

Runner execution duration: **48.224 seconds**. Arm duration including setup and runtime preflight: **54.507 seconds**. Later independent validation and development preparation are excluded. No watchdog timeout occurred. Owned scratch workspace was removed; no processes with owned workspace arguments remained.

## Recovery evidence and limits

Original task evidence survives in SQLite. Continuation user text does not restate the expired-token constraint. The restored envelope contains the original requirement, progress, next action, current snapshot and evidence IDs: **1,345 rendered UTF-8 bytes / 449 locally estimated tokens**. Its SHA-256 is `e2b2a2a72342eda0cc81a11ca2e613a3e28d6584044abf268510c2e77d06607f`. Native userMessage content equals that envelope exactly. The same thread ID appears in start, compaction, resume and second turn. The original checkpoint, recovered-context.json and actual delivered input are all preserved separately.

**Native replacement history also retained the original requirement in plain text.** Therefore this run proves Continuum's persistent recovery/delivery path and successful post-compaction behavior, but it does not prove that native Codex forgot the requirement or that Continuum caused the correct result. No retrieval-tool call was needed or observed; the agent used native filesystem tools. Autonomous Continuum retrieval availability is tested offline, not demonstrated by this live task.

## Actual reported usage

The native per-response ledger has eight distinct response IDs: seven generation responses and one compaction response. Cumulative notifications are not added to those response records.

| Operation | Input | Cached input (subset) | Uncached input | Output | Total |
|---|---:|---:|---:|---:|---:|
| First generation | 11,473 | 0 | 11,473 | 28 | 11,501 |
| Genuine compaction | 11,521 | 11,008 | 513 | 211 | 11,732 |
| Second generation (six responses) | 79,877 | 60,160 | 19,717 | 1,532 | 81,409 |
| **Whole experiment** | **102,871** | **71,168** | **31,703** | **1,771** | **104,642** |

App-server's last thread notification reports 92,910 tokens (91,350 input, 60,160 cached, 1,560 output), excluding exactly the native compaction record's 11,732 tokens. Compaction-time notifications repeated the earlier 11,501 total. Receipt of such a notification is not proof that its total includes compaction. Raw and corrected measurements are retained separately.

Eight completed provider responses do not establish a complete underlying request/retry count. Observable Continuum retries: zero. Observable host retry events: zero. Unobservable internal retry count, actual Codex credits and actual monetary cost: **unavailable**. The 85k threshold was reactive, never a hard billing cap.

At the recorded current [official standard Luna API rates](https://developers.openai.com/api/docs/models/gpt-5.6-luna), the observed text-token ledger corresponds to **$0.00988916 API-equivalent estimated cost**. This is not an actual subscription charge, historical invoice, guaranteed spending ceiling, or estimate of development-session credits.

## Audit and implementation

The old packet was optional but default, and durable mode added first-turn recovery repeating the user objective. Both recorder injections measured 3,356 actual rendered bytes; captured/redacted trace text measured 3,360 bytes / 1,120 estimated tokens. The second native message corroborates 3,356 bytes / 1,119 estimated tokens; the first exported native text does not match that recorder size. These measurement sources remain separate. Seven source identities were included. In experiment 2, four exact version bodies from two files appeared again in tool output. This is repeated transmission, not proven billable waste. Host base/developer instructions account for substantial visible characters; precise token attribution is unavailable.

Implemented configuration strategies: initial_packet (unchanged default), minimal_manifest, on_demand. Shared retrieval and durable recovery remain in the existing engine/database. Delivery receipts distinguish rendered/serialized bytes, estimates, source identity, omissions, snapshot and actual ACK. Invalid values, shadow-mode misuse and disabled retrieval tools fail. Corrected recorder role from system to user. No migration or architecture replacement.

The separate offline same-task measurements show smaller manifests/preload, but no superiority claim: initial_packet 3,049 rendered bytes, minimal_manifest 690, on_demand zero. Native exploration still repeated material during the on-demand live run. Zero preload did not prevent multiple provider responses or the budget overrun.

## Confirmed defect and offline repair after the experiment

The preflight usage tests were insufficient: they assumed thread cumulative notifications covered compaction. This host exposes additional compaction usage in native records. Post-live repair reads the isolated thread's exact compaction usage before continuation, verifies thread/response identity, reconciles whether notifications include or omit it, adds a verified offset once, and applies the same provider threshold to attributable consumption. Missing or ambiguous accounting now blocks continuation. Generation/compaction usage remains separate from context occupancy, which is unavailable.

Regression tests replay this exact omitted-usage record, included/omitted/ambiguous scope, wrong thread, repeated accounting and threshold behavior. The corrected guard stops the saved replay earlier; that is an offline observation, **not measured live savings**. Future reports also export native per-response totals automatically and return a nonzero exit status for failed live experiments. Resume snapshot metadata now uses the refreshed session rather than the pre-refresh snapshot; a changed-source regression verifies receipt/execution identity and historical evidence labeling. This live run had unchanged source before resume, so that metadata correction does not alter its result. Frozen execution code is under implementation-source; repairs afterward are under after-live-accounting-fix. No second live run occurred. Corrected monitoring has not been qualified live.

## Conclusions

| Claim | Classification |
|---|---|
| Original task storage and provenance | Verified |
| Genuine native compaction | Verified |
| Recovery delivery and same-thread continuation | Verified |
| Final fixture requirement compliance | Verified |
| Budget-qualified end-to-end experiment | Failed |
| Corrected compaction-inclusive monitor | Verified offline; unverified live |
| Active context occupancy | Unavailable |
| Better relevance, lower tokens/cost, superiority | Unverified |

**Next technical action:** qualify compaction-inclusive usage monitoring and continuation feasibility before advancing to any paid comparison. The four-to-six-response estimate was insufficient: this run had eight completed responses. Keep budgets frozen; do not raise them or retry automatically. A future recovery-off control would be needed to establish added value because native replacement history preserved the requirement too. Any further live run requires new approval.

## Evidence

See result.json, implementation.md, experiment-design.md, readiness.json, readiness-after-live.json, previous-evidence-check.json, source-state.json and offline/validation. Live artifacts include the complete JSONL trace/native rollouts, original/final fixtures, SQLite database, per-response usage ledger, recovery payload/receipt evidence, source comparison, validators, configuration and native compaction event. Both earlier evidence sets were hash-verified unchanged. This stage ran one paid benchmark; cumulative historical smoke count is three, with 156,751 observed tokens across all three. Development credit consumption is unavailable.
