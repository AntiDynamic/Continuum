# Continuum Decision Log

This log records decisions that should survive context compaction and repeated
agent sessions.

## 2026-09-20 — Use preflight as a separate treatment

Decision: keep ordinary MCP (`continuum_on`) and prompt-injected preflight
(`continuum_preflight`) as separate experiment arms.

Reason: MCP tools are invoked during an agent session, so a model may already
have spent tokens on broad exploration before requesting Continuum context.
Combining both behaviors would make it impossible to identify whether savings
came from retrieval quality or earlier delivery.

## 2026-09-20 — Adapt the initial packet by task risk

Decision: use four first-delivery profiles rather than one fixed token budget.

Reason: routine local tasks should not pay for broad orientation, while
security, migration, and cross-package tasks need more constraints and
contracts. Required coverage must remain explicit when the budget cannot fit
it; it must never disappear silently.

## 2026-09-20 — Do not claim cache savings from estimated packets

Decision: report estimated Continuum packet tokens separately from provider
input, cached-input, output, reasoning, and cost measurements.

Reason: a smaller internal packet is not proof that the model received fewer
tokens or that a provider applied a cache discount. The adapter must expose
usage, and repeated controlled runs must confirm the effect.

## Earlier decisions

The broader Phase 5 and Phase 6 decisions remain in:

- [Phase 5 plan](phase5-plan.md)
- [Phase 6 effectiveness plan](phase6-agent-effectiveness-plan.md)
- [Context efficiency research](context-optimization-research-2026-09.md)
