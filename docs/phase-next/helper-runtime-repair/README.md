# Codex helper isolation repair — offline readiness PASS

No new live inference or model-driven benchmark was launched. The previous execution lock and all 54 hashed first-smoke evidence files are unchanged.

## Root cause and repair

Codex 0.162.1 uses `InstallContext::current().code_mode_host_program()` when its process-owned Code Mode provider starts lazily. Discovery prefers a package resource named `codex-resources/codex-code-mode-host`; otherwise it checks the package `bin` directory, legacy standalone layout, then the current executable's sibling. The installed helper is `bin/codex-code-mode-host`.

The old boundary bound only the main executable as `codex-runtime`. Package metadata and its helper were unavailable, so discovery selected a missing sibling. The repaired boundary mounts the package's `bin`, `codex-resources`, `codex-path`, and metadata **read-only**, preserving the layout. It also provides the same Node executable used by the evaluator.

The user's original home is now hidden as well as the project/evaluator root and host `/tmp`. The recorder directory remains hidden; only the task's separate Codex home is exposed. Required runtime paths are reintroduced through explicit read-only mounts. Original Codex, Claude, Gemini and other histories under the user's home remain inaccessible. Environment inheritance is restricted to runtime settings and applicable proxy/certificate settings; unrelated credentials are not inherited.

Exact release sources are saved in `host-source/`. The discovery implementation is in `codex-rs__install-context__src__lib.rs`; process launch is in `codex-rs__code-mode__src__remote_session__connection.rs`. This repair deliberately rejects unreviewed package layouts and versions.

## Preflight readiness

| Check | Result |
|---|---|
| Required binaries executable; runtime dependencies load | PASS |
| Actual Code Mode helper executes JavaScript over V1 stdio | PASS — `continuum-helper-ok:42` |
| Native Codex sandbox command executes without a thread/turn | PASS — `continuum-command-ok:42` |
| HOME, CODEX_HOME, PATH, shell and model configuration | PASS |
| Hidden validators, previous reports, recorder and histories inaccessible | PASS |
| Missing/non-executable helper or missing interpreter fails before inference | PASS |
| Failed/stalled operations cancel and clean up | PASS |
| No test process groups remain | PASS |
| Final provider usage survives an observer/threshold stop | PASS, mocked provider regression |

The actual helper uses little-endian u32 length-prefixed JSON protocol V1. Preflight opens a local session, evaluates bounded JavaScript and closes the session. It also checks `rg`, bundled bubblewrap, zsh and Node startup. A real App Server initializes, reads configuration, and executes a bounded `command/exec`; that API does not create a thread or model turn.

All these operations use the same filesystem, working-directory and environment boundary as the runner, with networking **additionally disabled**. No authentication is copied until preflight passes. Outgoing preflight App Server methods are restricted to initialization, configuration reading and local command execution; model-generation requests are forbidden.

Cleanup waits a bounded interval for the entire owned process group to disappear and escalates signals if necessary. Negative tests include an actual failing JavaScript operation, a stuck cell, an unavailable helper, a non-executable helper and a missing interpreter. Unrelated running Codex processes are preserved.

## Usage investigation

The preserved native response-ID records show:

| Response | Input | Cached subset | Uncached input | Output |
|---|---:|---:|---:|---:|
| First | 12,784 | 0 | 12,784 | 177 |
| Second | 13,023 | 12,032 | 991 | 68 |
| Total | **25,807** | **12,032** | **13,775** | **245** |

The reported **26,052 total tokens** sum both responses within one logical turn. It is not the size of one input context. Two failed helper tool operations are recorded; those are not proof of provider transport retries.

Observable text includes 17,730 characters of host base instructions, 5,363 of native developer instructions, a 1,236-character auxiliary user message, and the 3,514-character explicit turn input (154 task characters plus Continuum's 3,360-character rendered envelope). Dynamic tool metadata is also present. These character counts identify visible context sources; they are **not token estimates** and cannot allocate the provider's input tokens to fragments. Full serialized provider requests, exact per-fragment token counts and billing rates remain unavailable.

`usage-analysis.json` contains the reproducible evidence analysis. It uses only saved files, deduplicates response identities and separates cached input from uncached input without model calls or price assumptions.

## Monitoring changes

The SDK now persists raw/normalized provider observations **before** an external safety observer can stop the execution. An ordinary reported-token stop marks the safety state stopped without breaking the raw callback channel, allowing the existing bounded interruption path to run. Regressions verify an interruption request, failed lifecycle closure, and preservation of the final reported snapshot.

The prior pending-request rejection fix is retained. The 20,000 reported-token stop remains reactive: a response can cross it, and the host may start work before client cancellation takes effect. No guaranteed token, output or spending ceiling is claimed.

## Validation and evidence

**Build PASS; typecheck PASS; lint PASS. Full tests: 299 passed, 0 failed, 4 provider-dependent tests skipped.** Twelve new regressions were added. Validation logs include initial test defects and final results, rather than hiding intermediate failures.

`dry-run/` contains a single prepared C cell, real runtime preflight traces, configuration, cleanup proof and durable requirements/recovery evidence. `process-cleanup.json` records the final process scan. `readiness.json` records checks, implementation hashes and runtime binary hashes. Previous paid-smoke evidence is unchanged.

To repeat only the offline preflight, choose a fresh output directory:

```sh
pnpm benchmark:recovery --dry-run --treatment C \
  --case authentication-compatibility --transition compaction \
  --output /tmp/continuum-runtime-preflight-review
```

## Limits

This is **offline runtime readiness**, not proof of agent understanding or real recovery. Model-driven tool dispatch, genuine native compaction, recovered continuation and comparative cost/performance were not retested. The previously identified visible authentication validator's unrelated cache check is unchanged; full end-to-end benchmark readiness is not claimed.

No further live test is authorized by this work. The existing single-experiment lock remains in place. Overall development-session billing is unavailable; no new live model inference was requested.

Official reference for non-inference command execution: [Codex App Server](https://learn.chatgpt.com/docs/app-server). Matching source URLs and release identity are recorded in the evidence.
