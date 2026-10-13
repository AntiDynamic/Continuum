# Four-treatment real Codex pilot — actual results

## Result

All four treatments completed both planned turns and passed all 16 independent behavioral checks, the unchanged public test, and modification-scope checks. Native Codex used the fewest reported tokens. Full Continuum finished fastest. This single matched synthetic warehouse task shows no correctness or requirement-retention advantage for Continuum. It does not establish general superiority for any treatment.

## Reproducibility

- Initial baseline: `8bba103940eea6973e6fdcf2597cff58c6be2efc`.
- Frozen benchmark and exact tested source: `e592458ee369b7b1dc82bb197537e1817f200f0f`.
- Shared fixture commit: `4aa7f181c50e3109ff6f8c4dba229b51b2929f24`.
- Model/provider/reasoning: `gpt-5.6-luna / openai / low`, verified at both native start/resume boundaries; Codex 0.162.1.
- Randomized realized order: A, B, C, D. One observation per treatment. No substitutions, parallel inference, automatic restarts or reruns.
- Same independent fixture clones, requirements, correction, native permissions, helper/runtime environment, behavioral assertions and fixed resource limits. Original content came from the benchmark Git revision; separate Git stores contain no other arm's solution.
- Plan/task/validator/script/compiled/source hashes: [live plan](live/plan.json). Configuration and runtime probes are inside each arm folder. All eight child process groups were confirmed gone.

The fixture has six TypeScript modules and two SQL migration files. Five source modules plus migration 002 required edits. The task exercises async API compatibility, transactional stock, duplicate lines, tenant isolation, durable idempotency, cancellation, integer pricing and rollback. An initially fixed fee is superseded in the second user stage; old stored receipts must remain stable. Hidden validators and reference code were masked from agents. No hidden feedback was supplied between turns, and no final code was repaired.

## Offline validation

Build, typecheck and lint pass. 233 workspace tests pass, four provider tests skip; the script suite plus final targeted additions gives 100 passing script cases (333 unique passing tests total). Original failed freshness-test evidence is retained: its first edit did not change an existing expression; corrected material edits and unrelated-test-scope regressions pass. Baseline/oracle/negative controls execute actual SQLite-backed implementations. Short, medium, long reconciliation and controlled-compaction workload definitions have failing starts and passing reference behavior. Only the medium natural workload was run live. [Validation evidence](validation/summary.json).

## Observed comparison

| Metric | Native | Full Continuum | Minimal | Adaptive |
|---|---:|---:|---:|---:|
| Behavioral assertions | 16/16 | 16/16 | 16/16 | 16/16 |
| Critical constraints | passed | passed | passed | passed |
| Input tokens | 135,943 | 181,727 | 250,807 | 171,467 |
| Cached input | 112,640 | 137,216 | 218,880 | 126,976 |
| Uncached input | 23,303 | 44,511 | 31,927 | 44,491 |
| Output tokens | 3,711 | 3,918 | 4,937 | 4,718 |
| Total reported | 139,654 | 185,645 | 255,744 | 176,185 |
| Difference from native | +0.0% | +32.9% | +83.1% | +26.2% |
| Compaction tokens | 0 | 0 | 0 | 0 |
| Completed provider responses | 9 | 10 | 14 | 10 |
| Tool completions | 7 | 7 | 11 | 8 |
| Retrieval calls / successful | 0 / 0 | 1 / 1 | 2 / 1 | 0 / 0 |
| Failed shell commands | 0 | 1 | 1 | 0 |
| Initial context bytes | 0 | 5089 | 628 | 0 |
| Continuation context bytes | 0 | 4470 | 4195 | 3357 |
| Exact source fragments repeated later | 0 | 9 | 5 | 0 |
| Generation execution seconds | 65.648 | 56.755 | 120.506 | 82.276 |
| Arm seconds including preflight | 68.902 | 59.753 | 123.208 | 85.104 |
| Verified monetary cost | unavailable | unavailable | unavailable | unavailable |

Cached input is a subset of input. Totals sum unique native per-response usage records, including any compaction operations; cumulative notifications are not summed. All final thread counters agree with native response ledgers in this pilot. Active context occupancy remains unavailable. Tool completions include commands, patches and dynamic calls, rather than only filesystem reads. Failure/retry correction of an agent-issued tool call is not a Continuum retry or another logical turn.

The B/C/D excesses over native are 45,991 / 116,090 / 36,531 total reported tokens in these observations. Total-token ranking is not a billing ranking: C has more cached input and less uncached input than B/D. Actual Codex credits and cost per successful task are unavailable. No API dollar estimate is substituted for actual billing.

## Context and recovery evidence

B preserves full original evidence and sends its baseline initial packet (5,089 bytes); C sends a 628-byte manifest; D sends no initial context. All three use the same memory/retrieval engine and proactively inject bounded recovery before the second turn. Their exact transport-delivered bodies and hashes are in the raw turn/start messages and supplemental analysis. SQLite original evidence, explicit objective/fee supersession, current critical constraints and bindings were independently inspected. Each arm resumes its own original native thread. Native also retains all independently checked original requirements without Continuum.

B's six initially supplied fragments appear again in shell output. Including autonomous retrieval, B has nine supplied fragments repeated later and C five. This is exact substring repetition of versioned source, not a token-cost attribution. The initial receipt-only audit omitted dynamic tool-delivered source identities; its original output remains intact. Supplemental post-hoc analysis joins frozen task evidence, dynamic replies and later tool output to correct that measurement gap. Raw reports and usages are unchanged.

B autonomously retrieved once; C issued two calls, one rejected and one successful. D issued no retrieval and queued no adaptive failure signals. D's event-driven source hydration therefore was not exercised live; its functioning remains supported by deterministic tests. Smaller initial context did not produce fewer provider tokens here: minimal had the largest observed usage.

The host reported a 258,400-token context capacity. Largest per-response input was 17,989 / 22,853 / 23,797 / 22,763 tokens; these request-usage figures are not active occupancy measurements. The task therefore provides no evidence of sustained window pressure. No native or explicit compaction occurred in any pilot arm. This was preregistered as natural workload, not forced recovery stress. Storage/recovery delivery at process continuation is verified; behavior under genuine pressure is untested by this pilot. Earlier genuine recovery evidence remains separate. Historical source references in B/C were labelled historical; they are not evidence of an actual stale-source coding error. Causal influence of recovery on the successful outcome is unproven.

## Confirmed failures and attribution limits

1. C's first dynamic request supplied `{args:{query:...}}`; the router rejected it with "Missing query argument". A corrected canonical `{query:...}` followed. This is an observed agent-issued shape error, not proof the host requires that wrapper. It caused one failed tool round trip. A compatibility normalization and invalid-type regression are an appropriate small offline repair, without rerunning this pilot.
2. B and C attempted `npm test`, which exited 127 because this isolated runtime exposes Node but not npm. The original task specified `node --test`; both agents then used that supported command successfully. This is a common-environment unsupported tool choice, not the previous missing Codex helper defect. Future real npm workloads need explicit dependency-layout preflight and equal exposure for all treatments.
3. Source delivery did not replace native exploration: B/C retrieved code and subsequently read overlapping source. Continuum does not observe whether a model understands a supplied fragment, and tool-schema/host-instruction overhead is not fully attributed by these traces.
4. Every treatment passed. The pilot cannot resolve correctness differences or failure-rate variation. One run per treatment cannot estimate run-to-run variance, significance or general token savings. Order/cache warming, stochastic coding choices, different validation/exploration and response counts remain confounds.

## Architecture priorities

1. **Normalize the observed retrieval argument wrapper and reject invalid types predictably.** Strong direct evidence: C had a rejected, immediately corrected request. Low complexity; callback must execute once. Offline behavior can be proved; live efficiency improvement cannot be claimed yet.
2. **Track native reads and dynamic deliveries by version before hydrating more source.** B/C repeated nine/five supplied fragments, despite retrieval. Use existing version IDs and receipt epochs; reset availability after real compaction. Explore lazy exact-evidence hydration, keeping critical requirements protected. Do not change the default from one sample.
3. **Test selective recovery and tool-surface ablations.** Every Continuum continuation sent 3.3–4.5 KB while native retained every checked constraint. Preserve original evidence and restore critical state whenever active coverage is uncertain; omit unchanged optional state only with verifiable coverage. Compare retrieval-only versus durable recovery to separate tool/schema overhead from recovery benefits. Requires a controlled follow-up, not an intuition-led rewrite.

No broad ranking/packing rewrite is justified. The current durable persistence/recovery machinery works, but this task did not demonstrate its marginal value. Adaptive's inactive policy cannot be credited with preventing any failure.

## Classification

| Claim | Status |
|---|---|
| Original evidence and supersession persist | Verified for B/C/D |
| Bounded recovery delivered before same-thread continuation | Verified for B/C/D |
| Independent behavioral compliance | Verified for all four in this fixture |
| Autonomous retrieval works | Verified in B/C; malformed C request failed |
| Adaptive event policy improves real behavior | Unverified; no live trigger |
| Continuum reduces total tokens on this task | Failed in these four observations |
| Continuum improves correctness | Unverified; all treatments pass |
| Real-compaction comparative performance | Unverified; zero compactions |
| Actual cost/credit efficiency | Unverified; billing unavailable |
| General superiority | Unverified |

## Credit and operation transparency

Exactly four model-driven benchmark runs, eight logical generation turns and 43 provider-reported completed responses. Zero explicit/native compactions, zero Continuum retries, zero observable host retries, zero cancellations/timeouts. Complete internal retry count remains unavailable. Combined reported usage: **757,228 tokens**. No larger study or repair-validation inference was launched. The 350,000 reactive per-arm limit was not reached; it is not a guaranteed spending ceiling.

Frozen-plan timestamp to final results-file publication: **360.032 seconds**, derived from recorded plan UTC time and filesystem publication timestamp. Per-arm times above include arm preflight and exclude final independent evaluation/export; generation times include local assist preparation. Actual billing is unavailable.

## Larger study proposal — not executed

Use four treatments × three task complexities × natural/controlled-compaction categories × two independent repetitions: **48 runs**. Block-randomize treatment order within task/repetition, refresh isolated fixtures, use unchanged validators and model/version/configuration. A second repetition permits only limited variation estimates; add a third only after reviewing variance and exposure. Current short/long workload definitions are synthetic and need feasibility refinement for sustained real context pressure. The present runner is deliberately pilot-only; general scheduling/controlled protocol handling must be frozen separately before the larger study.

The pilot consumed 757,228 reported tokens, below its broad planning range ceiling; this does not predict long workloads. Conservative per-run reactive planning thresholds of 150k short / 350k medium / 650k long, with a separately calibrated compaction allowance, imply roughly **18.4–20 million reported-token exposure** for 48 runs. This is not a billing guarantee; credits are unknown. Refine upper ranges with task feasibility before approval. Stop on drift, missing telemetry, isolation/cleanup failure, credits/quota, common benchmark defects or the frozen per-run resource policy; retain behavioral failures and censored runs without automatic reruns.

Approval is required before launching that paid study. No further live inference is authorized by this report.

## Implemented repair after the frozen study

The observed one-level `args` retrieval wrapper is normalized into the existing query callback. Canonical inputs remain supported; nonstring, empty, deeply nested and conflicting inputs return structured failures without retrieval. Three router regressions and a replay of the exact frozen C request pass offline. The source-delivery analyzer now includes dynamic tool replies and requires repeated output to occur after delivery; real frozen B/C data validates nine/five repeated source fragments. Both changes occur after the tested benchmark revision and do not alter its results. No model-driven repair test was run.

Post-repair build/typecheck/lint pass; Codex package tests report 47 passed and one provider test skipped; all 102 script tests pass. Combining unchanged workspace coverage yields 338 unique passing offline cases and four skipped provider cases. The wider architectural priorities remain proposals until a controlled study supports them.

The illustrative 48-run envelope is not a ready budget for naturally compacting long tasks. At the observed 258,400 host capacity, several responses near that scale can exceed a 650k long-run allowance. The staged reconciliation fixture is not established as a genuine pressure workload. Curate realistic long tasks and recalibrate before approving that campaign. A lower-risk first repeated step is four treatments × short/medium × two repetitions = **16 runs**, with an illustrative aggregate reactive exposure of **4 million reported tokens** (8 × 150k + 8 × 350k), unknown credits and final-response overshoot possible. Neither study was launched.

## Evidence

- [Frozen raw manifest](frozen-live-sha256.json), [analysis](analysis.json), [reproducible analyzer](analyze-frozen.py).
- [Native](live/A/result.json), [full](live/B/result.json), [minimal](live/C/result.json), [adaptive](live/D/result.json).
- Each arm contains exact configuration, raw JSONL/native history, per-response ledger, validator outputs, final source/diff/hashes and cleanup records; B/C/D also contain SQLite memory and delivery receipts.
- Supplemental A/B/C/D analysis includes dynamic deliveries, timing, original evidence, active critical requirements and bindings. Previous experiments remain unchanged.

Account email is redacted in the committed protocol/database exports. Original raw files remain locally preserved, byte-identical to the frozen manifest, and are excluded from Git. No credentials were copied into evidence. The analyzer accepts original files or redacted exports without changing measured usage/task results.

### Public repository publication

The public PR publishes a sanitized snapshot rather than the original local commit
chain, because earlier smoke-test Git objects contain account email metadata.
Original commits and raw evidence remain local. Published original revision IDs
continue to identify those immutable local records; exact frozen benchmark source
snapshots and hashes are included in `frozen-benchmark-source/`. Earlier public
protocol/database exports redact account email only, preserving usage and task data.
`docs/phase-next/publication-redaction.json` records the export exceptions. Raw
forensic hash manifests refer to the retained originals, not redacted derivatives.
