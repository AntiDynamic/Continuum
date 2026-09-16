# Context Optimization Research and Conversation Record

Date: 2026-09-12

## Purpose

This document records the planning discussion about reducing context tokens and
cost while preserving the context required for correct repository edits across
long-running agent sessions, loops, and compaction events.

## Project baseline

Continuum currently provides repository indexing, hybrid retrieval, token-aware
packet construction, progressive context sessions through CLI and MCP, Codex
shadow evidence capture, usage evidence, and local SQLite persistence.

The local verification baseline is passing after the previous repair:

- Build, typecheck, and lint pass.
- Shared tests: 47/47.
- Codex tests: 40/40.
- CLI tests: 18/18.
- MCP tests: 4/4.

Phase 3D repository benchmarks currently report an estimated median packet
reduction from 7,920 to 1,847 tokens for Continuum's real-repository case,
approximately 77%. The controlled benchmark reduction was approximately 30%.
Mandatory coverage recall was 98.61% and duplicate full-content resend was 0%.
These are packet estimates, not provider billing measurements.

## Core product objective

Give the agent the smallest complete context packet required to make the next
correct change, while preserving important context across unlimited work loops.

The primary metric is:

> Cost per accepted, verified task, with no meaningful regression in task
> success, required-context recall, or rework.

The target is not merely the smallest possible prompt. A smaller prompt that
causes more searching, retries, or incorrect edits can cost more overall.

## Context model agreed during planning

Continuum should model context as:

```text
durable project state
+ current task state
+ required edit packet
+ progressive evidence deltas
+ validation feedback
```

Context should be separated into tiers:

- Tier 0: task, current state, blockers, and required constraints.
- Tier 1: edit targets, symbols, and direct dependencies.
- Tier 2: contracts, tests, schemas, migrations, and security rules.
- Tier 3: related implementation and historical decisions.
- Tier 4: optional background.

The initial packet should normally contain Tiers 0–2. Tiers 3–4 should be
retrievable progressively.

Durable state should store facts, decisions, failures, active work, and
references—not large copied file contents.

## When context should be delivered

1. Before the first agent action: a 200–500-token bootstrap containing the task,
   likely edit files, likely symbols, required categories, and validation hints.
2. Before the first edit: exact symbols, contracts, callers, and directly
   related tests.
3. After a search or tool result: only new context, never unchanged content.
4. After a test failure: the failure, changed symbols, and failure-driven
   context only.
5. Before or after compaction: a recovery packet containing durable state,
   current files, constraints, blockers, and next action.
6. Before completion: a validation and coverage receipt.

Refresh should be event-driven: file changes, snapshot changes, test failures,
new subsystem discovery, compaction, or explicit uncertainty.

## MCP decision

MCP is a suitable access layer for mid-session context retrieval, but it is not
the complete context-management solution. MCP standardizes resources, prompts,
and tools; it does not force a host or model to call a retrieval tool at a
particular point. Tool results also enter the model conversation and can create
cost if large results are repeatedly returned.

Continuum should use MCP for on-demand retrieval and use native agent tools
where a host provides a stronger integration. The planned interface is:

- `context_plan`: task classification and likely files/symbols.
- `context_get`: exact item retrieval under a token budget.
- `context_delta`: new context driven by a failure or explicit request.
- `context_recover`: compact durable state after compaction or restart.
- `context_receipt`: what was delivered, referenced, omitted, or repeated.

Each item should have a stable ID, content hash, repository snapshot hash,
symbol/path identity, requirement category, token estimate, and delivery state.
Explicit session handles should be used for cross-call state.

## OpenAI and Codex implications

OpenAI's current Responses API exposes compaction and context-management
controls. Compaction returns an opaque continuation item and reports usage for
the compaction pass. It preserves continuity but does not make compaction free.

Prompt caching reduces the price of repeated prefixes, not necessarily the raw
number of tokens. Continuum should therefore separate:

- raw input tokens
- cached input tokens
- uncached input tokens
- output tokens
- reasoning tokens
- compaction tokens
- tool calls

Stable content should appear at the beginning of the prompt and dynamic task or
failure context at the end to improve cache reuse.

Continuum's current Codex shadow mode records the predicted packet but sends
Codex only the original task. It therefore measures potential context and
Codex behavior but does not yet reduce Codex exploration cost. Future assist or
native dynamic-tool work must be measured against a normal Codex baseline.

## Relevant 2026 research and projects

### Agent Retrieval Bench

Agent Retrieval Bench evaluates whether a retriever finds the files an agent
needs next, rather than merely finding text similar to a query. It covers
code-to-test, comment-to-context, trace-to-code, and edit-to-ripple tasks, plus
no-gold and wrong-repository controls. Its findings indicate that no retrieval
family dominates every task and that logged agent trajectories miss every gold
file on a significant minority of samples.

Implication for Continuum: add intent-specific retrieval evaluation, negative
controls, abstention calibration, and a distinction between retrieved context
and context actually used.

Source: https://arxiv.org/abs/2607.24882

### CORE-Bench and SWE-Explore

These 2026 benchmarks isolate repository retrieval and exploration instead of
using only final patch success. They treat finding files, functions, related
tests, and distractor filtering as measurable capabilities.

Implication for Continuum: benchmark localization, exploration loops, and
context acquisition independently from final task completion.

Sources:

- https://arxiv.org/abs/2606.11864
- https://arxiv.org/abs/2606.07297

### ContextBench

ContextBench reports that sophisticated agent scaffolding may produce only
marginal retrieval gains, that agents often favor recall over precision, and
that there can be a gap between context explored and context used.

Implication for Continuum: optimize useful-context precision and downstream
utility, not only Recall@K.

Source: https://arxiv.org/abs/2602.05892

### ContextSniper

ContextSniper combines hybrid retrieval, runtime evidence, intention-aware
filtering, and recoverable context outside the prompt. Its reported pilot
results show large token and cost reductions, but also a small decrease in
resolution rates.

Implication for Continuum: cost reductions must always be reported beside task
success and rework. Aggressive compression is not automatically an improvement.

Source: https://arxiv.org/abs/2607.01916

### CTX, ContextAtlas, and persistent MCP memory projects

Several active 2026 projects combine graph memory, compact task packs,
Tree-sitter or structural indexing, read-cache compression, token-aware
packing, and MCP delivery. Other projects focus on portable Markdown memory,
append-only memory, or cross-agent project state.

Implication for Continuum: these capabilities validate the direction, but our
differentiator should be evidence quality: snapshot-bound delivery, required
coverage, provenance, context utility, provider usage, and cost per verified
task.

Examples:

- https://github.com/Alegau03/CTX
- https://github.com/codefromkarl/ContextAtlas
- https://github.com/nova-land/coding-agent-memory-mcp
- https://github.com/susomejias/rembric

## New research opportunities

1. Required-context prediction: predict required files, symbols, tests, and
   constraints before the agent explores.
2. Context utility: measure whether a delivered item was cited, used in an edit,
   requested again, or irrelevant.
3. Compaction quality: compare raw transcript compaction, structured recovery,
   and structured recovery plus exact edit targets across many context windows.
4. Refresh policy: learn when retrieval should refresh after edits, failures,
   snapshot changes, or subsystem changes.
5. Cache-aware packing: preserve stable prefixes and minimize changing content.
6. Adaptive budgets: use smaller budgets for isolated edits and larger budgets
   for security, migration, and architecture tasks.
7. Cross-agent portability: compare Codex, Gemini, Claude, Qwen, Cursor,
   Windsurf, Aider, and other MCP-capable hosts using the same task corpus.

## Proposed Phase 5

### Context Delivery and Compaction Optimization

1. Add a durable context-state schema and recovery packet.
2. Add stable context item IDs, hashes, snapshot binding, and delivery receipts.
3. Split retrieval into plan, get, delta, and recover operations.
4. Record retrieved, delivered, referenced, repeated, omitted, and used items.
5. Add context utility and required-context recall metrics.
6. Add Codex GPT-5.6 baseline and assisted-mode experiments.
7. Add provider-neutral usage and cached-input accounting.
8. Add compaction recovery experiments across 1, 3, 5, and 10 windows.
9. Add cache-aware packet assembly and adaptive budgets.
10. Publish measured results only after end-to-end task evaluation.

## Success criteria

- No statistically meaningful task-success regression.
- Required-context recall at least 97–99%.
- Zero duplicate full-content resend where the content is unchanged.
- 50–80% lower initial repository context on suitable tasks.
- 30–60% lower repeated context over a complete task.
- 20–40% lower uncached input cost before provider-specific caching.
- Measured cache-hit rate and compaction cost.
- Lower cost per accepted, verified task.

These are targets, not current claims.

## Conversation decisions recorded

- The primary goal is reducing token count and cost while preserving required
  context across repeated loops and compaction.
- Context should identify files and symbols to edit, required tests, contracts,
  constraints, and validation commands.
- MCP is useful for mid-session retrieval but cannot by itself guarantee timing
  or optimal context selection.
- Continuum should combine an initial packet, MCP/native tool retrieval, durable
  recovery state, and delivery receipts.
- GPT-5.6's stronger model and compaction capabilities improve the baseline, but
  Continuum still has value in repository-specific retrieval, deduplication,
  required coverage, and cost measurement.
- All claims about savings must distinguish estimated packet reduction from
  provider-measured input, cached input, reasoning, compaction, and total cost.
- The next major implementation phase should focus on context delivery and
  compaction optimization before a dashboard or broad adaptive learning system.

## Sources consulted

- MCP specification: https://modelcontextprotocol.io/specification/2025-06-18
- MCP 2026 specification changes:
  https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx
- OpenAI Responses API: https://developers.openai.com/api/reference/cli/resources/responses/methods/create
- OpenAI compaction API:
  https://developers.openai.com/api/reference/java/resources/responses/methods/compact
- OpenAI Codex usage guidance: https://help.openai.com/en/articles/11369540
- Gemini context caching: https://ai.google.dev/gemini-api/docs/caching
- Alibaba/Qwen context cache:
  https://docs.modelstudio.console.alibabacloud.com/en/model-studio/context-cache
