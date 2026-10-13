# Context efficiency audit and implementation

## Initial-context findings

`CodexAssistExecutionService.runAssist` previously starts a session with `createInitialContext: contextEnabled !== false`, session maximum 8,000 locally estimated tokens. The controller selects adaptive initial caps: lean 1,000 / standard 1,250 / complex 1,450 / critical 1,500 estimated tokens, up to 6–10 items. The 1,900 constant is a section allocation ceiling, not the maximum of every delivered profile. Durable execution adds a separate recovery checkpoint (default 1,500 estimated tokens) before every turn, including the first. Repository envelope and recovery are concatenated and injected as a second **user input item**, not a host system instruction. The recorder's incorrect `system` role label is corrected to `user`.

This preload was default, not mandatory (`contextEnabled:false` removes repository context/tools); session APIs and MCP already offer optional initial delivery. It repeats the original task in the recovery objective. Both captured/redacted traces contain a 3,360-byte/character envelope (1,120 locally estimated tokens). The recorder measured **3,356 actual rendered bytes** in both runs; the second native message corroborates 3,356 characters / 1,119 estimated tokens. The first exported native message is also 3,360 bytes and does not corroborate the recorder, so its exact original serialized content cannot be claimed from that sanitized export. Serialized JSON sizes are recorded separately in context-audit JSON. Original task occurs twice across initial input items. Included sources: README.md, SECURITY.md, docs/authentication.md, AuthService and TokenClaims in src/auth-service.ts, and import/test symbols in tests/auth-service.test.ts.

In the second experiment four exact delivered version bodies from two files recur in command output. In the first, missing helper prevented reads. These are observable repetitions, not proof of wasted billable tokens. The native history retains the initial message; subsequent per-response input and cached usage are observed, but serialized provider requests and fragment attribution are unavailable. Both second responses reported 12,032 cached input tokens. Attribution of that cache to Continuum versus native prefix is unverified. No manual deletion of native history is attempted.

Host base instructions measured 17,730 characters in both runs; developer instructions 5,363 / 4,170 characters; explicit initial inputs 154 + 3,360 characters. Those are characters, not tokens. Provider cumulative usage was 26,052 / 26,057, comprising two response records each. Active context occupancy is unavailable. Crossing 20k cumulative usage did not imply a full context window.

Snapshots/version IDs are captured, and fresh retrieval refreshes source identity after edits. Historical task evidence is explicitly marked. Already delivered code remains historical text in Codex's native history until host compaction; Continuum cannot retroactively remove it. Storing versions does not guarantee agent understanding.

## Strategies and compatibility

Existing `.continuum/config.json` now accepts `contextDelivery.strategy`: **initial_packet** (unchanged default), **minimal_manifest**, **on_demand**. Assist CLI `--context-strategy` overrides it. Unknown values and use in shadow mode fail. Non-baseline strategies require context tools enabled. Resume bindings include non-default strategy and reject drift; old baseline bindings remain compatible.

- **initial_packet:** retains current packet and durable first-turn recovery bodies as baseline; bounded source selection, omissions and coverage remain visible.
- **minimal_manifest:** current input supplies the objective; manifest references original evidence, session/memory version and current snapshot, restores additional critical requirements, excludes superseded entries and flags historical evidence. No source bodies. At most 500 estimated rendered tokens; fail explicitly if essential manifest cannot fit. Advertises only enabled retrieval tools.
- **on_demand:** no initial repository excerpts or additional envelope. Original user objective is still automatically stored. Existing repository and durable-evidence tools remain available. Durable recovery is automatically rendered on continuation, regardless of preload strategy. Initial checkpoint is preserved but not falsely marked delivered when omitted.

Durable recovery/resume remains an explicit existing option (`--durable-memory`); choosing a repository delivery strategy does not silently enable persistent agent execution. All strategies share the existing retrieval engine/database. No migrations, second database, model summaries or service were added.

Prepared and acknowledged delivery receipts include strategy, source/version IDs, omissions, rendered UTF-8 bytes, serialized input JSON bytes, Unicode characters, local token estimate, snapshot, memory version, configured budget and hash. They persist in the existing recorder as explicitly local measurements, and the benchmark exports them. ACK alone is not agent-understanding proof; native userMessage events are checked for actual input receipt. Initial/continuation rendered envelope cap: 4,000 estimated tokens, recovery checkpoint cap: 1,500. All counts are local estimates; no provider tokenizer guarantee.

Offline same-task receipt measurements (fake protocol, not provider billing): initial_packet 3,049 rendered bytes / 3,174 serialized bytes / 1,017 estimated tokens; minimal_manifest 690 / 754 / 230; on_demand 0 / 0 / 0. These use the strategy test's explicit security task, not the historical live task; numerical comparison with the old 3,360-byte packet is not a treatment result. Measurement receipts and their exact tasks/provenance are preserved.

## Accounting and experimental controls

`recovery-usage-ledger.mjs` deduplicates response IDs, rejects conflicting records, preserves raw usage and normalized cached/uncached usage, links timestamps/tools/compaction/retry events and raw evidence paths, records cumulative snapshots without summing them, and keeps active occupancy null. Model context capacity is separate. API-equivalent estimates require known cache-write accounting and exclude long-context premiums; actual Codex credit billing stays null. Official current rates and source timestamp are recorded. Historical API-equivalent text totals are about $0.003290 and $0.003683 at today's rates, not actual historical charges.

The existing benchmark gains a preparation-only minimal-recovery case with unchanged authentication behavior checks, no requirement repeated in continuation except the recovery path, on_demand delivery, frozen evidence-based 85k threshold, one approval-specific permanent lock and the existing external watchdog. First-turn substantive tool work or edits stop it. Missing compaction telemetry or configuration drift stops it. No automatic restart, generation retry or extra turn is introduced. The old authentication case retains 20k. Compaction timeout now requests interruption when a native turn ID exists, then closes boundedly. A missing compaction ACK no longer produces an unhandled completion rejection; regression added.

## Validation integrity and limits

The prior visible-validator scope repair was present and verified. Authentication tests no longer run unrelated cache assertions. Both validators independently exercise invalid and valid tokens; subject and finite future expiry plus synchronous string refresh are checked. Regression inputs include baseline, correct fix, hardcoded subject and expired claims. Mock runner's unchanged source fails independent validation; mock compaction is separately counted, never proof of native compaction.

Known limitations: on-demand retrieval can miss relevant information; a manifest can omit optional background; native summaries may already preserve requirements, so successful recovery does not establish causality or superiority. No observed prompt-fragment billing or active occupancy exists. Native retries and true hard output/billing caps are not controlled by this host. Real behavior requires the one controlled experiment, not packet-size comparisons.

## Post-live measurement corrections

Native compaction used 11,732 reported tokens omitted from app-server thread counters;
full third-run consumption is 104,642, not the thread snapshot's 92,910. The native
ledger now classifies compaction separately and prospective runner totals use its
per-response sum. Continuation reads and reconciles the isolated compaction record;
missing, conflicting or ambiguous attribution fails closed. The 24 accounting/guard
regressions pass without inference. These corrections were not used in the completed
live attempt; frozen code and raw failure report remain preserved.

Audit sizes also distinguish transport captures from actual recorder measurements:
old recorded rendered bytes are 3,356 in each experiment, while redacted trace text
measures 3,360. Experiment 2's native message corroborates 3,356 / 1,119 estimated
tokens; experiment 1's exported native text does not. A regression preserves this
provenance discrepancy rather than silently normalizing it away.

Prospective receipts now time session preparation and recovery checkpoint
construction/write separately; the benchmark times its explicit recovery call.
Those processing metrics are unavailable for the completed live attempt. The observed
817ms gap between native compaction completion and second turn start includes host
startup, resume, database and transport work, and is not labeled recovery latency.

Resume metadata also discarded the refresh result; it now uses the refreshed snapshot for execution and receipts. A real SQLite changed-source regression verifies identity and historical labeling. This live fixture was unchanged before continuation, so its recorded snapshot was unaffected. Failed prospective live benchmarks return nonzero; the historical raw exit/report remain preserved.
