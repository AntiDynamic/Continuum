# Single approved recovery smoke: guarded, but blocked

No live generation, explicit compaction, automatic retry, or model-driven benchmark experiment was executed. The one-run authorization remains unused.

## Confirmed host blocker

Installed Codex is **0.162.1**. The source for its matching release shows:

- `host-source/provider.rs:699`: built-in providers use `entry(key).or_insert(provider)`. Configured `model_providers.openai` overrides therefore do not replace the built-in provider.
- `host-source/provider.rs:67`: the built-in defaults include five stream retries. HTTP retries and stream retries are separate layers.
- `host-source/responses_retry.rs:121`: switching transport can reset the stream retry counter.
- `host-source/client.rs:1795`: authentication recovery can resubmit a Responses request independently of the configurable transport retry counts.
- `host-source/features.rs:1382`: unbounded connection retries are enabled by default. That feature is explicitly disabled in the prepared smoke configuration, but disabling it does not remove the other retry layers.

The public configuration reference documents provider retry settings, but does not establish that they replace built-in provider values. Source inspection resolves that distinction. Source snapshots are from OpenAI's `rust-v0.162.1` tag, not a decompilation of the installed binary. We deliberately refuse inference when a complete retry bound cannot be established.

Do not remove the gate based only on echoed configuration values. Do not silently use a custom provider, change authentication, upgrade the host, or substitute a model to bypass it.

## Implemented guards

- Four-attempt maximum for explicitly safe **pre-inference metadata** operations: 2/4/8-second backoff, provider Retry-After handling, bounded retry deadline, explicit proof of no completed or billable generation, and attempt/error/usage records. Unsafe and ambiguous failures stop. Continuum never resubmits `turn/start`, compaction, or an entire experiment. These helper bounds do **not** imply a four-attempt provider-wide guarantee.
- A fail-closed host retry assessment before credentials are copied or a generation is launched.
- Model, provider, low reasoning, and correct-thread checks at start/resume; model-rerouting notifications stop the experiment.
- Two logical generation requests and one compaction, serialized operations, a persistent exclusive experiment lock, and no automatic benchmark restart.
- Explicit disabling of agent collaboration, goal continuation and unbounded connection retries. `isolated-config-final.json` confirms those values through a real isolated App Server configuration read.
- A 60-second generation deadline; graceful interrupt RPC bounded to at most five seconds; bounded shutdown waits followed by SIGTERM and SIGKILL. Isolated POSIX process groups and bubblewrap's die-with-parent behavior are enabled.
- A 64 MiB process-output byte limit. This is a recorder resource limit, **not** a provider output-token or spending cap.
- Mandatory reported usage before compaction/continuation, counter checks, a reactive 20,000-thread-token stopping threshold, and no second turn without post-compaction usage. Missing measurements remain unavailable.
- Recovery-content checks before the second request; genuine modern compaction evidence required; full redacted raw transport recording for any future allowed live attempt, including compaction and failed first-turn attempts.
- Fixed live configuration: Treatment C, authentication compatibility fixture, compaction transition, 60-second timeout, 20,000 reported-token threshold, one repetition. Dry runs remain available for other development cases.

## Validation

Build, workspace typecheck, and workspace lint pass. **286 distinct tests pass, zero final failures, four provider-dependent tests skipped.** The count combines the full workspace suite with updated package/script/subset reruns; `report.json` documents the arithmetic and exact command logs.

Twenty new regressions cover safe transient retry, exhaustion, forbidden retry classes, rate-limit guidance, ambiguous completion, missing usage, configuration drift, excess turns, concurrency and exclusive locks, failed/simulated compaction, invalid recovery, thresholds, host retry limitations, disabled host features, automatic assist timeout, graceful interruption, SIGKILL escalation, and excessive process output.

The first new timeout fixture needed initialization/indexing and a realistic startup/test allowance. Its initial failures are documented; the final real-service/mocked-host test passes. A real configuration read initially returned a null provider because the default was implicit; the prepared configuration now explicitly sets `model_provider = "openai"`, and the final read passes.

`prepared/report.json` contains a single isolated dry-run cell and independent baseline failure (the expected negative control). Original requirements are recorded in real SQLite and recover into a complete bounded packet in `prepared/offline-recovery.json`. The initial fixture commit and source versions are retained in `prepared/prepared-workspace`. No credentials are exported.

The prepared database is an evidence snapshot containing original canonical repository paths, not a portable resume database. A future allowed live run must initialize its fresh isolated workspace.

## Live results and credit accounting

| Observation | Result |
|---|---|
| Requested/configured model | `gpt-5.6-luna` |
| Requested/configured provider and reasoning | `openai`, `low` |
| Effective inference configuration | Unverified: no inference thread started |
| Live experiments / logical generation turns / explicit compactions / automatic retries | **0 / 0 / 0 / 0** |
| First turn / native compaction / recovered continuation | Not executed |
| Independent validation of an agent result | Not executed |
| Reported input / cached input / output tokens | Unavailable |
| Live elapsed time | Not applicable |
| Attributable cost and total session billing | Unavailable |

Only metadata operations were sent to real Codex during preflight. Tests use deterministic local computation and mocked hosts. No paid benchmark inference was requested. This does not establish zero total development-session cost.

No claim of native compaction recovery, agent understanding, reduced credits, or better performance is supported by these results. There is no guaranteed spending ceiling. The remaining prerequisite is a supported and verified host path that honors the retry and authentication-failure policy; the current runner remains blocked until that exists.

## Evidence

- `report.json`: consolidated results, limitations and implementation hashes.
- `model-inspection.json`: real model/effort advertisement and authentication metadata.
- `isolated-config-final.json`: actual isolated configuration and metadata-only protocol trace.
- `isolated-config.json`: earlier diagnostic showing the implicit null provider.
- `validation/`: build, typecheck, lint, suite, updated regressions, dry-run and failure logs.
- `host-source/`: matching official release source used to assess retry behavior.
- `implementation-source/`: exact changed source versions, without unrelated work.
- `prepared/`: configuration, independent baseline validation, original fixture source and commit, SQLite evidence and bounded recovery.

Official references: [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference), [App Server protocol](https://learn.chatgpt.com/docs/app-server). Exact release source URLs are recorded in `report.json` and `prepared/report.json`.
