# Phase 3C validation and go/no-go

> Historical gate: Phase 3D supersedes this decision; see [phase3d-go-no-go.md](phase3d-go-no-go.md).

Decision: **NO-GO for native Codex integration.** Harden deterministic retrieval and repeat this gate.

## Acceptance

The built CLI child-process workflow passes repository creation, init, index, session start, status/context after restart, exact and repeated requests, signal, persisted report, completion, and post-completion rejection. Sessions and snapshots survive restarts; initial delivery is singular; repeated identical content becomes references; reports reconstruct from SQLite; completion expires active context.

The actual CLI/MCP stdio fixture passes after MCP restarts. Both interfaces resolve the same session and sequence, MCP stdout remains JSON-RPC, repeated content is not resent, report counters agree, and post-completion requests fail.

The adversarial suite covers every requested case. It found one product defect: initialized-but-unindexed repositories recommended init. The service now recommends index, with regression coverage. Windows path, cleanup, and duplicate-rate defects in the benchmark harness were also corrected without changing production ranking.

## Controlled metrics

| Metric | Measured |
| --- | ---: |
| Recall@1 | 48.26% |
| Recall@5 | 87.92% |
| Recall@10 | 93.61% |
| Precision@5 | 68.33% |
| Precision@10 | 42.92% |
| MRR | 88.89% |
| Mandatory coverage recall | 92.36% |
| Median initial packet | 1,454 estimated tokens |
| Median retrieval latency | 8.628 ms |
| Duplicate full-content resend | 0% |

Exact-symbol and exact-path Recall@1/5/10 were 100%. Five cases failed Recall@10 or coverage: SQL security test evidence, two configuration cases requiring unavailable test coverage, a documentation/config vocabulary miss, and an ambiguous “time out” versus “timeout” task.

## Ablations

| Configuration | R@5 | R@10 | P@5 | MRR | Coverage | Median tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Lexical | 83.13% | 93.61% | 61.67% | 88.54% | 92.36% | 1,454 |
| Lexical + graph | 84.65% | 92.78% | 65.83% | 89.58% | 92.36% | 1,454 |
| Lexical + coverage | 87.22% | 93.61% | 65.83% | 85.42% | 92.36% | 1,454 |
| Lexical + graph + coverage | 87.92% | 93.61% | 68.33% | 88.89% | 92.36% | 1,454 |
| Full | 87.92% | 93.61% | 68.33% | 88.89% | 92.36% | 1,454 |

All ablations share the 8.628 ms median production retrieval latency. Graph and coverage improve R@5 and P@5 over lexical-only, but not R@10 or coverage.

## Real repositories

The Continuum isolated source copy measured Recall@10 80%, MRR 56.67%, median retrieval latency 551.904 ms, and median initial packet 7,920 estimated tokens over five pre-labelled cases. The MCP case missed; its predeclared symbol was later verified as a ground-truth ambiguity (ContextCompilerMcpServer versus actual ContinuumMcpServer), while the expected file also missed the top ten.

The unrelated aurum-dining copy measured Recall@10 90%, MRR 90%, median retrieval latency 76.981 ms, and median initial packet 6,956 estimated tokens. Its reservation-contract type path ranked 11, and the predeclared ReservationFormData symbol was later verified as a ground-truth ambiguity for actual ReservationData.

## Gate

- Exact symbol/path 100%: pass.
- Mandatory coverage at least 95%: fail at 92.36%.
- Controlled Recall@10 at least 85%: pass at 93.61%.
- Duplicate resend 0%: pass.
- Medium-repository median latency below 500 ms: Continuum fails at 551.904 ms; aurum-dining passes.
- Initial packet normally at most 1,500 estimated tokens: controlled median passes; both real-repository medians fail.
- Acceptance and safety tests: pass.

Next address vocabulary/candidate seeding, task-to-test relationships, coverage semantics, and real-repository packet sizing, then repeat Phase 3C. Do not begin native Codex integration yet.
