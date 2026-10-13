# Pre-inference design and calibration

Selected Level 1: Treatment C, **on_demand**, gpt-5.6-luna/openai/low. Maximum two generation turns, one explicit compaction, no experiment replay. Native compaction stays enabled. Same isolation, tools, watchdog (240 seconds + 10 second termination grace), generation timeouts (60 seconds), compaction timeout (30 seconds), and permanent approval-specific lock. No parallel inference. Internal Codex 0.162.1 retries are acknowledged; Continuum retries remain zero on inference operations.

The original requirement demands empty/expired rejection in both AuthService methods, preserved signatures and TokenClaims, and token-specific refresh. First turn acknowledges those requirements without exploring or editing. After genuine compaction, continuation says only to implement the recovered original task and validate; it does not repeat the security/compatibility constraints. This is a functionality test, not a comparable task-efficiency benchmark. A preparation-only first turn is deliberate; the eventual independent assertions remain unchanged. First-turn edits or tool calls violate this procedure and must stop the experiment.

## Budgets kept separate

- Provider usage reactive threshold: **85,000** reported cumulative thread tokens, fixed before inference. Exact usage may exceed it; no guaranteed billing ceiling.
- Context occupancy: unavailable. modelContextWindow is capacity, and last.inputTokens is request input consumption; neither is exact active occupancy. Do not use cumulative usage as compaction pressure. No fill-up generations.
- Operations: two logical turns / one compaction. At most three safely retryable metadata retries allowed, none on generation/compaction. No host hard output token cap is established; use timeout, process output byte ceiling, and cancellation.

## Evidence-based calibration

The four historical completed responses cost 12,636–13,421 reported tokens apiece. A minimal acknowledge turn is intended to require one response; implementation may require two to four responses; remote compaction may require one response. Thus the planning range is **four to six response equivalents, approximately 50,500–80,500 reported tokens**. The 85,000 threshold rounds the observed upper six-response equivalent (6 × 13,421 = 80,526) upward by about 5.6%. This is a planning allowance, not a measured compaction price or enforced maximum response count. Native compaction can have different cost, optional telemetry, or retries; the range can be wrong. If telemetry is absent, counter identity is inconsistent, or usage exceeds threshold, stop. Do not raise the budget in flight.

This resolves the previous known design failure (two responses already exceeded 20k), without claiming source preload caused all usage or adjusting final validators. The old 20k default remains for old cases; only this approval-specific minimal case accepts 85k.

## Future levels (not executed)

Level 2 after functionality success: recovery on/off and stale/invalid evidence variants, isolated equal snapshots/model/config/tools/limits; independently verify constraints, false facts, and final behavior. Recovery receipt alone cannot establish causal benefit because native compaction may preserve the requirement too.

Level 3 after reliability: native / retrieval / durable recovery, identical complete tasks, independent hidden assertions, frozen snapshots and configuration, randomized treatment order, repeated trials and preregistered exclusions. Report correctness, success rate, full provider usage (compaction included when known), and cost per verified successful task separately. Compare delivery strategies within equivalent tasks; do not compare this preparation-only smoke against prior implementation-first tasks as an efficiency claim.

## Sources

Installed 0.162.1 generated protocol: ThreadCompactStartParams requires only threadId, no occupancy minimum. Client waits for matching native contextCompaction completion and then resumes the persisted same thread with recovery in turn/start input. Official [App Server documentation](https://learn.chatgpt.com/docs/app-server) describes manual compaction, immediate ACK, lifecycle events, resume and interrupt. The matching release's remote compaction path calls a remote model endpoint and returns optional token_usage and response_id; compaction is potentially billable. Offline mock lifecycle tests establish integration sequencing, not native model behavior. Live protocol events determine whether this host actually completes it.

Current [official Luna model pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna): $0.20 uncached input, $0.02 cached input, $1.20 output per million tokens. Any calculation is an API-equivalent text-token estimate, **not actual Codex subscription credits**. Cache writes/long-context premiums/unknown operations require separate accounting; actual billing remains unavailable.
