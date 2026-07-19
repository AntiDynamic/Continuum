# Phase 3D real-repository hardening and go/no-go

Decision: **GO for beginning native Codex integration work.** This decision applies only to the deterministic retrieval and packet-delivery gate. Native execution, provider-token savings, end-to-end task latency, and coding-task success were not implemented or measured in Phase 3D.

## Root-cause evidence

The pre-change composition profile showed that packets were already symbol-level (`fullFileTokens = 0`), but the legacy packet builder consumed nearly the entire 8,000-token budget with optional candidates. Continuum's median packet was 7,908 symbol tokens: 349 mandatory and 7,571 optional. Aurum's median was 6,956 symbol tokens: 1,307 mandatory and 5,755 optional. Oversized symbols such as `MIGRATIONS` (6,897 estimated tokens), `ContextEngine` (4,781), and `Reservation` (8,459) dominated candidate cost. Escalation candidates were already metadata-only and were not the source of delivered tokens.

## Production policy

Normal initial delivery has a hard 1,900-estimated-token ceiling with explicit sections: orientation 250, exact implementation 700, mandatory contracts/constraints reserve 350, directly related tests reserve 350, and optional context ceiling 250. Mandatory items may use unused global capacity but never silently exceed the hard ceiling. An oversized mandatory item is omitted as oversized, marks coverage incomplete, and reports the additional estimated budget required. Exact symbol content suppresses a containing whole-file representation unless that file contributes distinct required coverage.

Coverage states are `required`, `recommended`, `not_applicable`, and `unavailable`. A required and available category with no selected evidence remains incomplete. A category with no applicable indexed candidate becomes unavailable with a reason and zero matching candidates; recommended or unavailable evidence does not create a false mandatory failure. Security constraints, public security contracts, database schema, and rollback remain mandatory where policy requires them.

## Controlled benchmark

The unchanged 24-case labels and formulas produced:

| Metric | Preserved baseline rerun | Phase 3D |
| --- | ---: | ---: |
| Recall@1 | 48.26% | 44.65% |
| Recall@5 | 87.92% | 88.68% |
| Recall@10 | 93.61% | 94.17% |
| Precision@5 | 68.33% | 66.67% |
| Precision@10 | 42.92% | 44.17% |
| MRR | 88.89% | 92.26% |
| Mandatory coverage recall | 92.36% | 98.61% |
| Median initial packet | 1,454 | 1,018.5 |
| p90 / maximum packet | not recorded | 1,388 / 1,601 |
| Median retrieval latency | 3.358 ms | 8.236 ms |
| p90 / maximum latency | not recorded | 11.063 / 23.582 ms |
| Irrelevant selected items | 6 | 0 |
| Duplicate full-content resend | 0% | 0% |

The Phase 3C gate reference latency was 8.628 ms; the separately preserved Phase 3D baseline rerun measured 3.358 ms. Both are retained because local latency varies and neither is provider or end-to-end latency. Exact-symbol/path Recall@10 remains 100%.

## Real repositories

| Repository | R@1 | R@5 | R@10 | MRR | Median packet | p90 / max packet | Median latency | p90 / max latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Continuum baseline rerun | 40.00% | 70.00% | 80.00% | 56.67% | 7,920 | not recorded | 264.581 ms | not recorded |
| Continuum Phase 3D | 30.00% | 40.00% | 80.00% | 49.05% | 1,847 | 1,899 / 1,899 | 152.797 ms | 255.875 / 255.875 ms |
| aurum baseline rerun | 36.67% | 90.00% | 90.00% | 90.00% | 6,956 | not recorded | 80.236 ms | not recorded |
| aurum Phase 3D | 41.67% | 90.00% | 90.00% | 100.00% | 766 | 1,520 / 1,520 | 113.748 ms | 150.249 / 150.249 ms |

The original Phase 3C reference latencies were 551.904 ms for Continuum and 76.981 ms for aurum. The two retained real-label ambiguities remain unchanged and reported as ambiguous.

Phase 3D composition medians are 678 mandatory plus 1,205 optional tokens for Continuum, and 565 mandatory plus 196 optional for aurum. All delivered content remains symbol-level. Continuum's p90 implementation/test/documentation/configuration/constraint totals are 1,899/866/171/0/1,154; aurum's are 1,520/407/0/174/0. Every case reports ten escalation candidates as metadata-only.

## Latency profile

The pre-change runner captured total request latency but did not yet expose per-stage timings, so no stage-level before values are claimed. Phase 3D added request-scoped benchmark instrumentation. Continuum p50/p90 values in milliseconds are: analysis 0.099/0.527, normalization 0.005/0.015, exact lookup 59.066/64.019, FTS 54.726/79.993, seeding 2.122/2.976, relationship expansion 4.933/36.553, coverage 5.610/11.456, database hydration 139.224/151.450, ranking 0.042/0.121, diversity 0.668/1.031, token estimation 0.055/0.130, and assembly 4.943/10.949. Hydration remains the dominant measured stage.

## Ablations

| Configuration | R@5 | R@10 | P@5 | MRR | Coverage | Median packet | Median latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Lexical | 81.04% | 94.17% | 65.00% | 92.08% | 98.61% | 1,018.5 | 8.236 ms |
| Lexical + graph | 88.68% | 94.17% | 65.83% | 92.26% | 98.61% | 1,018.5 | 8.236 ms |
| Lexical + coverage | 87.43% | 94.17% | 69.17% | 92.08% | 98.61% | 1,018.5 | 8.236 ms |
| Lexical + graph + coverage | 88.68% | 94.17% | 66.67% | 92.26% | 98.61% | 1,018.5 | 8.236 ms |
| Full | 88.68% | 94.17% | 66.67% | 92.26% | 98.61% | 1,018.5 | 8.236 ms |

Full ranking is retained because it combines verified relationship and coverage evidence, matches the best R@5/R@10/MRR result, and provides production explanations even though lexical-plus-coverage has higher Precision@5 in this dataset.

## Gate

- Exact symbol/path Recall@10 = 100%: pass.
- Controlled Recall@10 at least 85%: pass at 94.17%.
- Mandatory coverage recall at least 95%: pass at 98.61%.
- Duplicate full-content resend = 0%: pass.
- Controlled median packet at most 1,500: pass at 1,018.5.
- Real-repository median packet at most 2,200: pass at 1,847 and 766.
- Continuum median retrieval latency below 500 ms: pass at 152.797 ms.
- Standalone acceptance and workspace quality gates: see the final Phase 3D run evidence.

These are estimated tokens and local retrieval timings. Provider-measured tokens, provider cost savings, end-to-end task latency, and coding-task success remain unmeasured.
