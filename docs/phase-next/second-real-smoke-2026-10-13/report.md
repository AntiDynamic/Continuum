# Second real smoke test — stopped before compaction

One newly authorized experiment executed. No restart or additional inference was requested. This is not a comparative performance result.

## Preflight

| Check | Result |
|---|---|
| Helper runtime and dependencies | PASS: real JavaScript helper and sandbox command inside actual isolation |
| Configuration | PASS: native thread response confirms gpt-5.6-luna / openai / low |
| Isolation and exclusive lock | PASS: validators, recorder, host history hidden; fresh approval-specific permanent lock |
| Retry and turn guards | PASS: one requested turn, zero Continuum retries; acknowledged internal Codex retry limitation remains |
| Cancellation | PASS: turn/interrupt acknowledged; turn/completed status interrupted; bounded process close |
| Usage monitoring | PASS: reported 26,057 tokens triggered interruption and blocked subsequent operations |
| Independent validator | PASS: scoped authentication fixture tests plus evaluator-owned behavioral assertions |

Build, typecheck, lint passed. Targeted offline validation: 55 passed, zero failed (25 durable recovery, 26 safety/isolation/validator, four cancellation). Previous full-suite result was not rerun.

## Timeline (UTC, 2026-10-12)

- 20:25:32.871: original requirements persisted as user evidence.
- 20:25:35.164: real thread configuration verified.
- 20:25:35.220: first and only generation turn requested; native userMessage completion records the initial Continuum packet.
- 20:25:40.085: reported cumulative usage 12,636 tokens.
- Agent successfully inspected source through the repaired helper/sandbox and patched authentication. A later search command exited 1 because no package/config files matched; this was not a missing-helper failure.
- 20:25:45.014: cumulative usage 26,057; stopping threshold reached.
- 20:25:45.015: graceful turn interruption requested.
- 20:25:45.060: native turn/completed reports interrupted.
- Final source preserved and independently validated without repair: visible PASS, hidden PASS.
- Compaction, recovered continuation, and second turn: never requested.

Execution duration: 12.464 seconds. Arm duration including setup/preflight: 18.623 seconds. These exclude later independent validation and earlier preparation.

## Separate results

**Infrastructure:** real launch, helper/tool dispatch, source edit, telemetry, and cancellation worked. First logical turn did not complete successfully; no compaction/resume evidence exists.

**Recovery:** original requirement text and critical objective are persisted with provenance in SQLite. Initial packet delivery is confirmed by actual native userMessage events. Restoration after genuine compaction is untested.

**Behavior:** final interrupted-task code passes both validators (empty/expired rejection, valid-token claims and refresh contracts). Only src/auth-service.ts changed. This does not demonstrate compliance after recovery or successful end-to-end completion.

## Provider-reported usage

| Response | Input | Cached input (subset) | Uncached input | Output | Total |
|---|---:|---:|---:|---:|---:|
| First | 12,481 | 0 | 12,481 | 155 | 12,636 |
| Second | 12,939 | 12,032 | 907 | 482 | 13,421 |
| Total | 25,420 | 12,032 | 13,388 | 637 | 26,057 |

Two completed provider responses belong to ONE logical generation turn. Their sum matches the last thread usage notification; these measurements are not added together again. One logical turn requested, zero logical turns completed, zero explicit compactions, zero Continuum retries. No host retry events were observed; complete internal retry count is unavailable. One cancellation, zero watchdog timeouts. Known monetary cost: unavailable.

Observed host base instructions: 17,730 characters; developer message: 4,170 characters; explicit Continuum input: 3,360 characters plus 154-character task text. These are character counts, not provider token attribution. The roughly 12–13k input per response makes the 20k cumulative threshold insufficient for this observed first-turn sequence. Exact prompt fragment tokenization and billing remain unavailable. The reactive threshold is not a hard cap.

## Changes and evidence

Authentication visible-validator scope corrected; independent claims checks and a baseline/correct/counterfeit regression added. Existing runner now preserves native per-response usage/session records and partial usage after interruption. This approval has a separate persistent lock; historical lock/evidence remain intact.

See readiness.json, result.json, source-state.json, offline logs, and live/{report.json,timeline.json,authentication-compatibility-C-trace.jsonl,native-rollouts,usage-analysis.json,persisted-memory-evidence.json,independent-validation.json,source-comparison.json}. Database, original/final fixtures, diff, runtime preflight, configuration and implementation source are retained. No authentication credentials were copied into the evidence export.

## Next technical action

Establish a feasible request/context budget for this host before seeking another live approval. The observed first-turn response sequence already exceeds the authorized cumulative threshold; unchanged limits cannot reliably reach compaction. Investigate supported prompt/request limits offline and do not raise the threshold or retry automatically. End-to-end recovery, genuine compaction, cost savings and superiority over native Codex remain unproven.
