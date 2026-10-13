# Frozen comparative pilot design

## Revisions and evidence

Baseline: `8bba103940eea6973e6fdcf2597cff58c6be2efc` (checkpoint committed before changes). Legitimate recovery implementation and prior forensic evidence were preserved. Unrelated launch-video assets and embedded historical Git histories remain untouched outside the commit. No push. The subsequent benchmark commit is recorded in each live plan; fixture and evaluator hashes are fixed before inference. Previous reports and failed runs are never overwritten.

The third real recovery experiment's native response ledger reports 104,642 tokens: 102,871 input, 71,168 cached, 31,703 uncached, 1,771 output. Its 11,732 compaction tokens were absent from ordinary thread notifications. Native replacement history also preserved the requirement. These observations establish integration, not a benefit over native Codex.

## Data flow and treatments

The existing indexer produces versioned SQLite source items; lexical/path/symbol ranking and bounded dependency expansion feed shared session packing. CLI, MCP and assist reuse that service. Durable original evidence/checkpoints use migration 14 in the same database. Native tools and dynamic Continuum tool results become subsequent model input. No indexing or deterministic policy operation calls a model.

A: native App Server with no Continuum dynamic tools, initial context or recovery. B: current initial_packet, retrieval and durable recovery. C: minimal_manifest, the same retrieval and recovery. D: adaptive, initially no repository body or manifest, with the same protected evidence/tools; observed unresolved failed tests and remembered source-version changes can trigger targeted retrieval at the next controlled continuation boundary. Later passing tests clear queued failure signals. Existing active-version references suppress repeated Continuum source delivery. It cannot stop native file reads or inject inside an ongoing model turn. Pure on_demand remains available. Default remains initial_packet.

B's original task appears again inside recovery, so preloading can duplicate user input. C omits it from the manifest because the task is already directly supplied. All Continuum modes restore active critical memory at continuation. Source versions close when changed and are hydrated freshly. Historical observations are labelled historical. No second context engine/database/planner was introduced.

Offline warehouse replay: B initial context 5,089 bytes, C 628 bytes, D zero. Continuation recovery 3,133 / 2,516 / 2,516 bytes under the fake tool history. These are deterministic rendered measurements, not provider savings. Real runs record their exact delivered bodies, receipts, hashes and source identities. Command path overlap and exact body repetition are separate measurements; neither proves attributable billing waste. Host system/developer/tool instructions are not fully exposed. Cached prefix attribution remains unknown.

## Task and independent validation

Warehouse reservation medium task: six source modules, synchronous API compatibility bug, tenant isolation, quantity/stock validation, atomic multi-line and duplicate-SKU handling, integer pricing, durable idempotency, cancellation, composite SQL uniqueness and data-preserving rollback. Two planned user stages: fixed fee initially; a changed fee policy later supersedes it while old receipts must remain stable. No hidden tests or failure feedback are supplied between stages. No solution is included in recovery.

Sixteen independent behavioral checks execute the agent's final source with Node 24 SQLite. The untouched baseline fails; an evaluator-owned reference passes; wrong fee, async interface, tenant lookup and rollback negative controls fail. Public tests cannot be changed. Hash comparison detects prohibited and unrelated edits; final code is not repaired after evaluation. Evaluators/oracles/recorder and other histories are masked. Source-import failure is an infrastructure failure, not a fabricated assertion score.

Short pricing/API, long staged inventory reconciliation and medium controlled-compaction definitions are prepared with failing starts and passing behavioral references. Only the medium natural pilot runs now. The controlled variant permits one explicit native compaction between stages in a future authorized study. No forced compaction occurs in the pilot; actual natural events and usage are recorded separately.

## Controls and limits

Exactly four runs, randomized sequential order, one per A/B/C/D. Luna/openai/low only, Codex 0.162.1, same original fixture commit/task stages/environment/native sandbox/watchdog/public tests/hidden assertions. Independent full Git clones created before inference avoid shared object stores and previous solutions; linked worktrees' external metadata would be hidden by the sandbox. Live fixture contents come from the frozen benchmark Git revision. All compiled artifacts and scripts are hashed before arms run. Fresh native threads per arm, same-thread restart between each arm's two stages.

Per arm: two planned turns, no automatic extra turns, no explicit compaction, three-minute turn timeout, ten-minute external watchdog with ten-second forced-kill grace, 64 MiB recorder output guard, 350,000 reactive reported-provider-token threshold. No in-run increase. Active occupancy is unavailable, not cumulative usage. Usage comes from unique native response identities including compaction; repeated cumulative notifications are not summed. Missing telemetry blocks continuation. Unknown usage/billing is never zero.

Calibration: prior minimal recovery required eight responses and 104,642 tokens; this multi-file implementation plausibly requires 12–20 responses with growing tool history. Planning range 180,000–350,000 per arm (720,000–1,400,000 across four), uncertain and possibly exceeded by a last response. This is not a guaranteed billing ceiling. No hard provider output-token cap is exposed by this reviewed App Server integration; local output-byte limits are different. Actual Codex credits are unavailable. Native internal HTTP/stream/reauth retries are not fully controllable and are explicitly accepted by the user. Continuum does not replay generation or compaction; zero automatic retries is within the maximum of three safely retryable metadata retries. Existing bounded retry primitives remain regression-tested.

Permanent experiment/arm consumed locks prevent restarts; an exclusive active-arm lock prevents concurrent inference. Process groups, timeout interrupt/close and forced termination are checked. A new configuration/isolation/authentication/credit safety defect or missing usage stops remaining arms; behavioral failure is preserved and does not trigger a rerun. Incomplete arms remain in reports.

## Interpretation and future study

n=1 per arm is exploratory. Report correctness, individual assertions, constraints, scope, input/cached/uncached/output, native compaction overhead, tool/retrieval activity and timing separately. No aggregate arbitrary score. Prompt-cache warmup/order and native context retention confound causal claims. No native superiority, savings or Continuum benefit is assumed.

A repeated study requires separate approval: four treatments × three complexities × two context-pressure categories × two repetitions = 48 runs, randomized within task/repetition blocks. Maximum planning thresholds would expose roughly 18–20 million reactive reported tokens, with unknown credits and possible final-response overshoot. Refine using this pilot's observed usage/failures before approving. Stop on new common infrastructure defects, missing telemetry, drift, quota or isolation failure; retain all failed/censored runs.

## Commands

`pnpm benchmark:comparative --dry-run --output <fresh-directory>`: metadata, helper, isolation, oracle/baseline checks; no inference.

`pnpm benchmark:comparative --run --approved-pilot --output <fresh-directory>`: the single authorized sequential four-arm pilot, requiring clean frozen tracked state. Permanent authorization lock prevents automatic repeats.

`pnpm test:comparative`: deterministic fixture, oracle, negative-control, memory replay and guard regressions.
