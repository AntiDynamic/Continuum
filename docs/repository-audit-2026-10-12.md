# Continuum repository audit — 2026-10-12

Implementation status: see the [follow-up changes, verification, and remaining qualifications](audit/implementation-2026-10-12.md). The findings below describe the pre-fix audit baseline.

Continuum has useful infrastructure, but its central product claim remains unqualified. The largest problem is evidence validity: the benchmark can label incorrect code a verified success, the retrieval coverage check can label an empty result complete, and the delivery budget does not bound the actual handoff. The runtime also rejects progressive delivery after ordinary edits. These defects must be repaired before another effectiveness study can be trusted.

This review covers the CLI, all eleven workspace packages, their test suites, benchmark scripts and fixtures, CI, installation metadata, and project/experiment documentation. Generated protocol schemas, vendored dependencies, historical raw provider transcripts, and video assets were not independently audited line by line. The local worktree already contained substantial uncommitted implementation changes; the review used that worktree and preserved those changes. Source conclusions below distinguish offline reproductions, static findings, historical results, and proposed designs.

## Cleanup completed

- Removed the unreachable legacy `index-repo.ts` command and unused CLI/MCP compatibility wrapper files. The entrypoints already use `index-compiler.ts`, `context-compiler.ts`, and `compiler-server.ts`.
- Removed five superseded extractors and their obsolete tests. The active TypeScript Compiler API, coherent Markdown, structured configuration, and statement SQL extractors remain.
- Removed the unused shared ranking/character-packing implementation and its tests; active retrieval and packet construction live in `context-engine`.
- Removed 32 generated `.js`, `.d.ts`, and map files beside repository-indexer test sources. They had caused duplicate tests and stale implementations to execute.
- Removed the one-off `scratch_update.ts`, `update-parser.js`, and FTS debugging script. The first two rewrote production source using string replacements and were not called by any current entrypoint.
- Removed six placeholder Codex regression assertions. Five were unconditional `expect(true).toBe(true)`; the remaining test assigned a string to a variable and asserted that same string. Vitest does not typecheck that assertion, and this package's TypeScript build excludes tests.
- Removed unused display helpers, a candidate-seeding loop that could never add an item, a score assignment overwritten before use, and an unused local variable.
- Removed six unused direct dependency declarations and pruned the lockfile. Shared ESLint dependencies required through `typescript-eslint` remain available through that package.
- Added a repository-indexer Vitest include rule for TypeScript test sources and ignore patterns for generated test output.
- Removed 40 stale ignored compiled outputs corresponding to deleted source modules. Active build output remains available.

There are 53 deleted source/test/debug/generated files, plus the ignored compiled outputs. Exact deleted-file copies are in `/tmp/continuum-dead-code-backup-20261012`; the manifest is `/tmp/continuum-dead-code-manifest.json`. Nothing was committed or pushed.

Knip was used as a candidate finder, followed by reference checks. Files loaded as subprocesses, benchmark distractors, fixture repositories, migration history, and current experiment tools were preserved even where static analysis called them unused. This cleanup removes private-workspace exports belonging to the superseded implementation; any undocumented external consumer of those old exports would need migration.

## Reproduce the findings

Cleanup validation passed: `pnpm build`, `pnpm typecheck`, `pnpm lint`, and
`CONTINUUM_DISABLE_CODEX_LIVE=1 pnpm test` (226 passed, four skipped).
`node --test scripts/phase6-outcome.test.mjs` also passed. The reduced pass
count reflects retired implementation tests, generated duplicates, and six
placeholder assertions; the live Codex test was explicitly disabled for this
offline audit. Functional findings below remain open and are not covered by a
passing end-to-end effectiveness gate.

After `pnpm build`, run:

```bash
CONTINUUM_LOG_LEVEL=error node docs/audit/reproduce.mjs
```

The script uses disposable repositories, synthetic provider events, and a fake bearer token. It makes no provider calls and does not read the real `.env` or alter the real repository's runtime database. [Recorded results](audit/results-2026-10-12.json) capture the audit run. A successful exit means the reproductions ran; it does not mean the reported product defects passed a quality gate.

## Findings and concrete repairs

### 1. Critical: the effectiveness benchmark does not verify program behavior

**Evidence: reproduced.** `scripts/phase6-verifier.mjs` and `phase6-hidden-verifier.mjs` inspect source text with regular expressions. Neither runs the implementation or the exported fixture tests. Several fixture “tests” are ordinary functions returning booleans without a runner invoking them. `phase6-tasks.json` nevertheless declares `validation: "fixture_tests"`.

The audit supplied a `readCache` implementation that always returns `"WRONG_STALE_VALUE"`. Comments contained the patterns the validators wanted. Both validators passed, and `deriveRunOutcome` returned `patchValidated: true` and `verifiedTaskSuccess: true`.

Calling the second regex checker independent hidden verification does not make it behavioral verification. Historical success labels from this harness must be treated as heuristic source checks. Existing provider token observations can remain useful diagnostics, but cost per *verified* successful task is not established by these checks.

**Repair:** define an executable test command and an independent evaluator test bundle for each task. Execute the original tests and evaluator tests against the patch with bounded timeouts. Keep evaluator test sources outside the agent-accessible workspace and apply/run them only during evaluation. SQL tasks should execute against a real disposable SQLite database and check migration/rollback/data preservation. TypeScript tasks need actual function calls and assertions. Scope rules and diff hygiene supplement behavior tests.

**Exit gate:** every task's intentionally incorrect starting state fails the relevant evaluator test; its reference patch passes; patches with matching comments, no-op implementations, weakened tests, wrong return values, and unsafe rollback fail. [SWE-bench's evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/) provides a relevant example of patch application followed by real repository tests in an isolated environment.

### 2. High: context delivery stops when the agent edits code

**Evidence: reproduced.** After indexing, starting a session, and making an ordinary edit, `service.request()` throws: “Repository state differs from the indexed session snapshot. Run `continuum index` and start a new context session.” The check in `ContextSessionRepository.recordDelivery()` protects consistency, but `controller.ts` has no supported refresh/transition operation.

This blocks the central progressive-delivery workflow precisely when an agent edits, gets a test failure, and needs additional context. `createCachePlan()` separately builds a packet using the current worktree identity against stored versions; unrestricted CLI/MCP searches likewise return old indexed content without checking the current index identity. The audit reproduced stale search results after the edit. One interface refuses all changes while another can attach current snapshot identity to old material.

**Repair:** retain a stable task session with append-only snapshot epochs. On a detected change, re-extract changed/deleted files, replace their graph edges, invalidate only affected versions, and advance the session epoch transactionally. Deliver replacements with `supersedes` references. Until that exists, return one explicit refresh-required result consistently across search, packet, handoff, and session APIs; do not claim current context from an outdated index.

**Exit gate:** edit → reindex/refresh → failing test → targeted request → corrected edit works under one logical task session. Unchanged items retain identity; changed items cannot be served as current. Deleted symbols and obsolete relationships disappear from current retrieval.

### 3. High: coverage completeness can mean “we found nothing”

**Evidence: reproduced.** `ContextEngine.coverageFor()` changes every category with zero retrieved candidates to `unavailable`, then only counts categories whose state remains `required` as missing. An empty candidate set for a security-sensitive task returned `complete: true`, `missing: []`, even though implementation, tests, security constraints, and contracts were absent.

Zero candidates does not establish that a requirement is inapplicable. It could mean a missed query, unsupported extraction, stale index, or a genuinely missing policy. Further, one vaguely related test or interface can satisfy a whole category; that is category presence, not task sufficiency.

**Repair:** separate applicability from acquisition. Preserve `required` independently of `availability: found | not_found | unsupported | stale`. A required item that is unavailable keeps readiness false. Waiving a requirement needs explicit evidence or a recorded policy decision. Attach requirements to concrete behaviors, symbols, contracts, and tests rather than just broad labels.

**Exit gate:** no-context and irrelevant-context controls remain incomplete; a missing security contract cannot silently become safe; different implementations sharing the same category cannot satisfy one another's task requirement.

### 4. High: actual delivery exceeds the budget and bypasses its receipt

**Evidence: reproduced.** One normal fixture delivery charged 1,073 estimated item tokens; the handoff layers were 2,806, and its complete serialized prompt was 2,995. The initial profile's advertised ceiling was 1,500. A session with a one-token total budget delivered zero items but generated the same 2,806-token handoff layers.

`handoff()` regenerates a cache plan from `initialPacket()` rather than building the handoff exclusively from the persisted, budget-constrained delivery. Stable-prefix text, per-item IDs/hashes/provenance, omission lists, wrapper instructions, and separators add substantial text outside the item budget. `buildContextEnvelope()` also emits a contextual header separately even though `item.content` is normally already `compiled_content` containing that header.

**Repair:** select and render through one path. Reserve wrapper/prefix/schema overhead before selecting items; estimate the final serialized agent input; enforce that final budget; persist the exact bytes, hash, included IDs, and accounting used for transmission. Large omission lists should stay in the audit database. Send short navigation metadata and exact source snippets to the model. A handoff cannot add items its delivery receipt rejected.

**Exit gate:** all delivery modes obey the same final-rendered budget, including an empty or tiny budget. Stored receipt hash equals the transmitted envelope hash; restoring the delivery returns the same accounting and membership.

### 5. High: `codex compare` fails before its first agent call

**Evidence: reproduced without contacting a provider.** `comparison-service.ts` creates a detached worktree and immediately calls `runShadow()`. Fresh worktrees do not contain the ignored `.continuum` initialization/database. The command fails with “Continuum is not initialised ... Run 'continuum init' first.”

Additional static risks: both arms share one worktree in fixed shadow-then-assist order; ignored build/runtime state survives `git clean -fd`; runs are recorded in the temporary worktree database while the comparison row goes into the original database. Deleting the worktree also deletes the execution evidence unless explicitly exported. Current comparison safety/schema tests were placeholders.

**Repair:** use two independent directories created from the same declared snapshot. Initialize/index each; install or prepare the same dependencies; randomize order; apply identical timeout, tool permissions, verification, and environment controls. Store task/cell/execution IDs and artifacts in a central experiment store before deleting workspaces. Respect `--repo` explicitly and reject ambiguous dirty-tree baselines unless the snapshot includes those changes.

**Exit gate:** an offline fixture agent produces a complete comparison and retrievable execution reports after both temporary workspaces have been deleted; neither arm inherits the other's ignored state; original tracked and untracked files remain byte-identical.

### 6. High: the default experiment arm lacks its main comparison report

**Evidence: reproduced.** Pilot defaults are off versus `continuum_preflight_only`. `phase6-report.mjs` counts these pairs but emits no corresponding pure-preflight-versus-off `...PairedByModel` section or Markdown comparison. `unpairedRuns` subtracts only off-versus-on pairs: the audit's complete two-cell preflight pair was reported as two unpaired runs.

The report also includes provider-failure records in treatment summaries despite saying failures are censored. Its `numbers()` helper converts explicit `null` to zero. Its bootstrap intervals estimate means while the adjacent point estimate is a median. None of those should silently share one interpretation.

**Repair:** use one parameterized comparison builder for any control/treatment pair. Report availability, eligibility, exclusions, cost completeness, success, completion, latency, and uncertainty explicitly. Keep operational provider reliability and task effectiveness in separate views. Preserve nulls; bootstrap the stated statistic; validate fixture reports in an offline script suite invoked by the standard test command.

**Exit gate:** the default two-cell experiment appears prominently in JSON and Markdown with zero unpaired cells. Unpriced usage remains unpriced. Provider-quota cells cannot alter a claimed task-success denominator without an explicit policy.

### 7. High: experiment usage and cost bypass the measurement contract

**Evidence: pure-helper reproduction and static review.** OpenCode's stream parser selects only the final `step_finish` rather than summing per-step usage. With two input events of 100 and 200 tokens, it reported 200. Missing fields default to zero. The pricing helper accepted an empty profile and calculated zero cost for nonzero input/output; the runner then labels any non-null calculation measured.

This is a second measurement implementation alongside `shared/context-efficiency.ts` and the usage evidence repositories. The runner lacks an enforced provider/model/effective-date/rate contract, cannot reliably distinguish inclusive versus exclusive cached input, and lacks cache-creation/storage accounting where applicable. Reasoning may also be counted differently by providers; it cannot be universally added as a separate charge.

**Repair:** introduce one adapter-normalized usage schema with explicit `per_step | per_response | accumulated`, token inclusion semantics, nullable fields, and a raw-event reference. Use it in both ordinary runs and experiments. Sum per-step events and take the final accumulated snapshot only for sources declaring accumulation. Require a matching versioned pricing profile with all applicable rates and record its hash. Label calculated costs derived; preserve unknown values.

**Exit gate:** recorded streams with multiple turns, retries, cached input, reasoning, missing fields, and partial termination produce correct independent totals. Empty or mismatched pricing never yields a priced success. Recomputing cost from stored events and the profile reproduces the result.

### 8. High: OpenCode MCP configuration is not validated against the host

**Evidence: static code plus official schema/documentation.** The runner writes `mcp.servers.continuum`; current [OpenCode documentation](https://opencode.ai/docs/mcp-servers/) and its fetched [configuration schema](https://opencode.ai/config.json) put server names directly under `mcp`, such as `mcp.continuum`. The runner also sends `cwd` and `codemode` without establishing support in the selected host version. Its readiness check reads its own assumed format rather than asking the host whether the tool was registered.

This is a confirmed mismatch with the currently published format. It does not prove that this mismatch caused every historical OpenCode timeout; historical baseline arms, CLI versions, startup, auth, and provider responsiveness need separate diagnosis.

**Repair:** pin the supported host version, validate config against that version's schema, use `mcp.continuum`, and verify registration through the host. Launch a wrapper or supported command argument to set repository working directory rather than an unsupported field. Keep configuration local and restore it through bounded cleanup. Establish a plain local/offline CLI fixture and a provider responsiveness check before declaring the integration operational.

**Exit gate:** the actual selected host accepts the config, lists the intended tool, calls it successfully, and restores the original config exactly. A dry-run that merely writes JSON does not satisfy the gate.

### 9. High: redaction is inconsistent across execution paths

**Evidence: reproduced at the storage boundary and traced through callers.** Codex services pass raw transport JSON to `CodexExecutionRepository.recordReceived()` without applying the configured redactor. Normalized event payloads, diffs, and assist tool content are likewise persisted directly. The audit's fake bearer token was stored unchanged even though the shared redactor removed it. `runTestCommand()` writes raw test stdout/stderr to files. Benchmark artifacts write raw agent output separately as well.

The README's general statement that raw agent output is redacted before storage does not hold uniformly across these paths. Local storage still needs a clearly described retention and capture policy.

**Repair:** put redaction/capture policy at every persistence boundary, with a common implementation for raw transport, structured payloads, diffs, test logs, and artifacts. Parse original data in memory; redact before disk. Make full raw retention explicit and record whether redaction occurred. Document which source-code/context content is intentionally retained and which provider data is transmitted.

**Exit gate:** synthetic built-in and custom-pattern tokens cannot be found in any persisted record or artifact for Gemini, Codex, tests, or experiments. Capture-disabled mode really prevents raw storage. Record deliberate exceptions rather than silently bypassing policy.

### 10. High: test confidence exceeds what the checks establish

**Evidence: static review and reproduction.** Removed duplicate generated tests and tautological assertions inflated the count. The five retrieval unit fixtures embed the entire task string only in relevant candidate content, making perfect lexical retrieval much easier than real localization. The “real” benchmark uses machine-specific `C:/Users/pares/...` paths and explicit implementation names. Its setup is not portable.

The retrieval ablations rerank candidates after full production retrieval; they reuse the full packet and latency for every mode. Removing a scoring term after graph expansion does not measure retrieval without graph expansion, and reusing a packet does not measure packing without coverage policy. Identical per-mode packet and latency results are therefore expected by construction.

The live Codex smoke also skips any non-completed run as “likely provider quota or model limits,” which can hide real integration failures. Ordinary `pnpm test` may initiate a real model call unless explicitly disabled. Benchmark/outcome scripts are mostly outside standard workspace testing. ESLint disables unused-variable, explicit-any, and floating-promise checks; passing lint is a limited signal.

**Repair:** use actual feature flags before candidate generation and packing; rerun complete pipelines for each ablation. Keep unit fixtures as unit fixtures. Add held-out natural-language tasks from frozen external repositories, no-gold controls, changed-file cases, distractor cases, and language-support boundaries. Make provider tests opt-in, and skip only classified known provider/environment unavailability. Add a scripts test target; progressively enable targeted lint/type rules in touched modules.

**Exit gate:** pipeline ablations produce independent packets/timings; changing a feature has a measurable test effect; unexpected live integration errors fail rather than skip. A default test run never depends on paid-provider availability.

### 11. Medium: retrieval heuristics are presented with excessive confidence

**Evidence: static review.** `inferContextRelationships()` resolves a relative import to the first non-import item in a matching file, does not resolve named bindings or workspace package imports, and infers tests through substring matching. It can label ambiguous same-name matches high confidence. Configuration edges select the first ten matching items. Edges are upserted but no complete graph replacement removes obsolete import/test relationships after edits.

Task classification uses unbounded keyword regexes: token-count work can become security-sensitive merely because it says “token”; common words containing “move” can become refactors. `packageNameFor()` hardcodes Continuum package names when indexing unrelated repositories. Structured JSON/YAML locations are computed from the first matching key and the number of lines in reserialized output, rather than source spans; repeated keys and compact JSON give unreliable locations. Markdown without headings is ignored. SQL extraction is a line-based heuristic, not a full SQL parser.

**Repair:** narrow the supported initial task/language family. Resolve imports/bindings through a TypeScript Program or language-server API, preserve direction and confidence, and replace edges per snapshot. Read package manifests instead of synthesizing `@continuum` names. Use parsers with source spans for structured data or label synthetic spans accurately. Match explicit token concepts and bounded words in task analysis; represent uncertain multi-intent classification.

**Exit gate:** named/aliased/package imports, duplicate symbol names, renamed/deleted symbols, repeated config keys, heading-free docs, and unrelated token-budget tasks have honest metadata and correct relationships. A [Serena-style language-server integration](https://github.com/oraios/serena) is a useful reference for symbol/reference resolution; [Aider's repository map](https://aider.chat/docs/repomap.html) is a useful reference for graph-ranked compact orientation.

### 12. Medium: caching and recovery are prepared structurally but not closed operationally

**Evidence: static review.** The stable prefix is a 2,400-character alphabetically ordered list of paths, symbols, and hashes, using at most 500 current versions supplied by a default query limit. It is not a representative dependency/test map of the entire repository. A global snapshot hash is repeated in compiled item headers and their content hashes, so an unrelated edit can invalidate every compiled item's identity. Cache layers are preceded by a dynamic session/task header in the handoff, undermining reuse of a shared beginning across sessions. Adapters declare `stablePrefixReuse: false` and `explicitPromptCache: false`.

Recovery contains initial delivery references and recent externally reported signals. It does not continuously capture decisions, completed edits, verified tests, or the current next action from execution. The compaction prompt is installed when the thread starts; it is not automatically refreshed as the task develops. Session delta construction always returns `restoredItems: []`, while active-state records have no connected native-compaction eviction/restore lifecycle. “Previously delivered” is not proof that exact content remains in the model's current context.

**Repair:** separate source-content identity from snapshot membership. Build a useful stable orientation prefix with structural dependencies, conventions, test commands, and public contracts; place dynamic task/session data after it in the actual provider request. Add provider-aware caching only after the selected host exposes reliable placement/usage semantics. Continuously derive durable task state from observed edits/tests/decisions, record context eviction/compaction, and restore required exact sources on demand. Preserve uncertainty about what was actually used.

**Exit gate:** unrelated edits do not change unaffected source identities; provider requests demonstrate stable prefix placement; cache usage is observed rather than inferred from hashes. An edit/test/compaction/request cycle restores the needed updated sources. [Official OpenAI prompt-caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching) and [Gemini caching documentation](https://ai.google.dev/gemini-api/docs/caching) describe provider-specific prefix matching, eligibility, and telemetry. A byte-stable local string alone is not a provider cache hit.

### 13. Medium: ordinary-run failures and test counts can be recorded incorrectly

**Evidence: reproduced.** If an adapter throws, `orchestrateRun()` rethrows before finalizing the run; the audit left the persisted run status `running`. `runTestCommand()` takes the first `N passed` match, which in Vitest output can be the `Test Files` line. The audit supplied two passed files and ten passed tests; it reported two passed tests with high confidence.

**Repair:** finalize all lifecycle paths in `try/catch/finally`, retaining partial usage/events, final snapshot when available, and a truthful terminal state. Parse machine-readable test reports or explicitly select the `Tests` summary. Track file counts and test counts separately; use unknown confidence if parsing is not supported.

**Exit gate:** thrown adapter, early process exit, timeout, cancellation, malformed output, and validation failure all leave a closed run record. Test totals match known multi-file reports.

### 14. Medium: installation and documentation do not describe one reproducible product

**Evidence: static review.** README/doctor advertise Node 18 although `node:sqlite` requires a newer runtime; several imports occur before doctor can report the mismatch. No root `engines` or `packageManager` pin establishes a reproducible supported toolchain. `repository-indexer` imports TypeScript at runtime but declares it only as a dev dependency; its clean script references `rimraf` without declaring that tool locally. Package/CLI/MCP version strings differ. CI enables Corepack without a pinned pnpm package-manager declaration. Research and architecture documents mix historical “not implemented” statements with current implementation.

**Repair:** publish one support matrix, choose and test the Node minimum, pin pnpm, declare runtime dependencies accurately, use one version source, and verify clean install/build/link/uninstall on supported systems. Separate dated historical evidence from the current feature/capability table. Add links from the README to the audit and current limitations.

**Exit gate:** a clean supported environment can install and run the documented workflow without the maintainer's absolute paths, global tools, or hidden development dependencies.

### 15. High: dirty-file parsing breaks attribution confidence

**Evidence: reproduced using real Git output.** `extractDirtyPaths()` applies one regular expression to ordinary, renamed, and unmerged porcelain-v2 records even though their field counts differ. For an ordinary modified file it includes the index object hash in the supposed path. The audit's `src/auth-service.ts` was not recognized as a dirty source path.

`computeDelta()` uses this set to decide whether an observed file change has low or high attribution confidence. A file changed before the agent runs can therefore be treated as clean and receive high confidence. This violates a central observer promise independently of context optimization.

**Repair:** use the canonical NUL-delimited porcelain-v2 inventory already implemented in `snapshot.ts` as the single parser for both snapshot identity and attribution. Handle ordinary, renamed, unmerged, untracked, quoted, Unicode, and whitespace-containing paths consistently. Separate before/after content changes from total diff against HEAD.

**Exit gate:** a dirty tracked file remains low-confidence when the agent edits it, while a clean file remains high-confidence; a pre-existing change left untouched is not attributed to the agent. Actual Git-generated rename/unmerged/path fixtures must exercise the parser.

## Why progress has stalled

There is no evidence that the idea itself is doomed. There is evidence that the current development process expands infrastructure faster than it closes the basic effectiveness loop.

1. **The evaluator is permissive.** Source-pattern matches became verified-success labels before executable evaluation existed.
2. **The runtime is incomplete.** The intended edit → failure → context request loop conflicts with immutable session snapshot checks.
3. **The efficiency objective is not aligned with transmission.** Budgets constrain selected items while wrappers, hashes, repeated provenance, and regenerated handoffs add uncontrolled text.
4. **Experiments combine interventions.** Treatment prompts command immediate editing and restrict broad exploration, while the baseline receives different strategy instructions. A changed prompt plus context plus tools cannot isolate the effect of context alone.
5. **Provider qualification stayed unresolved.** The experiment log documents quota, access, no-event, and timeout failures before a reliably responsive priced baseline was established. Adding more hosts multiplied failure surfaces without resolving that prerequisite.
6. **Gates rewarded internal behavior.** Small self-authored fixtures, explicit names, fake assertions, and reranking-only ablations let the project advance while deployed workflows remained broken.

The September low-tier gate recorded lower measured tokens with preflight and a failed treatment task. That does not establish savings. Because the task validator is itself heuristic, even its baseline “verified success” label needs stronger qualification. The recent successful live Codex smoke demonstrates a working connection on one small task, not a cost benefit.

## Recommended implementation sequence

**Stage A — repair truth and establish an offline release gate.** Implement findings 1, 3, 6, 7, 9, 13, and 15. Add executable evaluator tests and deliberately wrong-patch controls; one normalized usage/cost contract; complete persisted receipts; correct Git attribution; and failure-safe run finalization. A fake agent should drive the entire experiment/aggregation path offline. Do not launch a paid benchmark until this passes.

**Stage B — make one task session survive real work.** Implement findings 2 and 4, then repair comparison isolation. Use one canonical final renderer for CLI/MCP/Codex, append-only snapshot epochs, and incremental refresh. Prioritize TypeScript bug fixes with real tests. Keep a context request tool available when coverage is incomplete; an agent must be allowed to verify assumptions rather than being forced to edit.

**Stage C — qualify one responsive provider path.** Select one installed supported agent/model after a connectivity, event-stream, and trivial behavior check. If using subscription-backed Codex without matching billable pricing evidence, qualify correctness/usage first and keep dollar cost unavailable. Use a priced API-backed path only when valid credentials and rates exist. Record version, model, event semantics, tools, timing, and price before the run.

**Stage D — compare increasingly complex context interventions.** Run the same prompt contract and permissions across independently initialized workspaces. Vary only the intervention being measured:

| Arm | Purpose |
| --- | --- |
| Native agent | Establish existing exploration and success. |
| Compact ranked repository map | Test whether simple orientation is enough. |
| Exact task packet | Test the incremental value of selected source/test context. |
| Packet plus targeted deltas | Test progressive delivery after edits/failures. |
| Cache/recovery intervention | Test provider caching or compaction separately after the previous arms work. |

Start with three frozen task families—local bug, cross-file contract, and migration—each with executable independent checks. Use a few repetitions to identify failures; expand a held-out dataset and repeats before making general claims. Predeclare success tolerance, spend caps, timeout handling, eligibility, and uncertainty calculation. Count costs of failed attempts as well as successful ones according to the declared experiment policy.

**Stage E — add sophistication only where evidence identifies a bottleneck.** Improve structural graph resolution, adaptive budgets, caching, and recovery based on measured missing-context cases or excessive tool output. Do not add a dashboard, learned ranker, new provider adapter, or a separate summarizing agent merely to complete a roadmap phase.

## External references and what they change

| Primary source | Relevant lesson for Continuum |
| --- | --- |
| [Aider repository map](https://aider.chat/docs/repomap.html) | Compare against a useful compact graph-ranked map before expanding a custom packet system. |
| [Serena](https://github.com/oraios/serena) | Resolve symbols and references through language services where high-confidence relationships matter. |
| [mini-SWE-agent](https://github.com/SWE-agent/mini-swe-agent) | A simple agent/environment/model boundary is a credible baseline; abstraction count does not establish quality. |
| [SWE-bench evaluation](https://www.swebench.com/SWE-bench/guides/evaluation/) | Apply patches and run actual tests under an isolated evaluator. |
| [Agent Retrieval Bench](https://arxiv.org/abs/2607.24882) | Test what the agent needs next, including no-gold and wrong-repository controls. The paper reports that no retrieval family dominates all its task types. |
| [The Complexity Trap](https://arxiv.org/abs/2508.21433) | In its tested settings, simple observation masking competes with summarization. Compare simpler interventions before paying for another model or subsystem. |
| [ContextSniper](https://arxiv.org/abs/2607.01916) | Its approach includes action memory and filtering long tool outputs. Continuum should measure repeated tool-output cost alongside initial packet size. This paper's findings do not establish Continuum's performance. |
| [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | Cache eligibility, prefix matching, and usage accounting depend on the actual rendered request and provider rules. |
| [Codex App Server](https://learn.chatgpt.com/docs/app-server) | Generate/probe the protocol against a pinned supported client instead of relying on a stale compatibility label. |
| [Gemini caching](https://ai.google.dev/gemini-api/docs/caching) | Implicit/explicit caching depends on API path and model; declare host capabilities and observe provider telemetry. |
| [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) | Tools are model-controlled. MCP availability alone cannot guarantee first-turn delivery; errors should use protocol error semantics. |
| [OpenCode MCP configuration](https://opencode.ai/docs/mcp-servers/) | Validate the host's accepted configuration and registered tools rather than validating a format the runner invented. |

The architectural recommendation is to focus Continuum on a small observable sequence: **retrieve relevant current evidence → deliver bounded exact content → observe edits/tests → refresh changed context → evaluate behavior → price recorded usage**. Every step needs a real acceptance check before broader optimization claims.
