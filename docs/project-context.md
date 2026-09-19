# Continuum Project Context

Updated: 2026-09-20

## Purpose

Continuum is a vendor-neutral context delivery and observability system for
coding agents. The current product goal is to reduce provider input tokens and
cost while preserving verified task success, correct scope, and recovery after
context compaction.

## Current implementation

- Repository indexing and snapshot-bound context items.
- Task analysis, coverage requirements, deterministic retrieval, and context
  packets.
- Progressive context sessions with initial delivery, targeted escalation,
  duplicate suppression, signal handling, recovery, and persisted receipts.
- CLI and MCP interfaces for session lifecycle and context delivery.
- Provider usage/cost evidence when the adapter exposes it; estimated packet
  tokens are kept separate from measured provider usage.
- Phase 6 isolated Antigravity/Gemini runner with fresh repositories, MCP
  registry snapshot/restore, visible and hidden verification, and paired
  reporting.
- Phase 6 OpenCode runner support with model-qualified runs, JSON-event parsing,
  project-scoped MCP configuration, and the same validation/evidence schema.
- Adaptive first-delivery profiles and a prompt-ready preflight handoff.

## Latest change

Commit `f307d6d` (`feat: add adaptive preflight context delivery`) added:

- task-aware first delivery budgets: lean 1,000; standard 1,250; complex
  1,450; critical 1,500 estimated tokens;
- `continuum session handoff <session-id> --json`;
- the `continuum_preflight` Phase 6 treatment, which injects context before the
  first model turn and reserves MCP for targeted deltas;
- preflight-vs-baseline reporting support.

## What is proven

- Full build and lint pass.
- Context-engine session tests pass.
- CLI standalone acceptance passes.
- MCP session product tests pass.
- Recovery smoke passes.
- The product lifecycle and evidence persistence work end to end.

## What is not proven

- A provider-cost reduction from Continuum.
- A provider cache discount from the preflight packet.
- A statistically reliable improvement in verified task success.
- Cross-agent results across Codex, Gemini, Claude, Qwen, or IDE agents.

The existing Gemini pilot was quota-censored before it could support a valid
effectiveness conclusion. Do not present the preliminary smoke files as a
final product result.

## Main known gaps

1. The ordinary MCP treatment still depends on the model voluntarily requesting
   context after the first turn.
2. `actuallyUsedItemCount` is not yet connected to agent file/tool evidence.
3. Provider cache-read telemetry is not consistently available through the
   Antigravity path.
4. Phase 5 cache-aware packing and cross-agent evaluation remain incomplete.
5. OpenCode is installed locally (`1.18.31`) and OpenCode Zen is now connected.
   The benchmark is restricted to the locally exposed free model IDs; the
   first pre-auth smoke timed out without model telemetry.

## Working rule for future changes

Every substantial implementation or experiment should update the relevant
Markdown log, record the commit and validation evidence, and distinguish
estimated context savings from measured provider tokens and dollars.
