# Continuum Delivery Implementation Options

## Recommended order

1. Pure preflight packet: compile and inject the stable prefix plus task delta
   before the first model turn. This is the new default pilot arm because it
   measures context value without MCP schema or tool-call overhead.
2. Targeted MCP escalation: expose only `continuum_request_context` after a
   validation failure or declared coverage gap. This is already implemented as
   the `continuum_preflight` diagnostic arm.
3. Provider-native caching: send the stable prefix as an immutable cacheable
   block and send only the task delta on later turns. This is the path most
   likely to reduce billed input, but it requires provider cache handles and
   cache-read telemetry; Continuum's byte-stable prefix alone is not proof of a
   provider cache hit.

## Other viable designs

- Host hook or middleware: inject the packet at session creation and after
  compaction without registering an MCP server. Lowest model-facing overhead,
  but it depends on the host exposing reliable lifecycle hooks.
- Restartable two-stage run: stage one compiles the packet; stage two starts or
  resumes the coding agent with the packet and adds MCP only if validation
  fails. Clear failure boundaries and easy measurement, but a restart can add
  latency and duplicate a small amount of prompt context.
- File-backed context manifest: write a short `.continuum/context.md` plus a
  machine-readable manifest and tell the agent to read it. Very portable and
  easy to debug, but the agent may spend extra tool calls reading it and it is
  less reliable than host-side injection.
- Dynamic tool registration: register one request tool initially and add
  broader tools only after the agent asks for them. This minimizes first-turn
  schema cost, but host support and tool-state races make it harder to test.
- Compaction hook: on every compaction event, restore only the stable prefix,
  current task delta, unresolved requirements, and active edits. Best for long
  sessions, but it needs a trustworthy compaction signal and strict duplicate
  suppression.

## Measurement rule

Compare each design against the same fresh repository and task. Record
provider input/output/cache tokens, cost with a versioned price profile,
validated patch rate, agent completion rate, verified success, tool calls, and
duration. A design is not a cost improvement if it lowers packet estimates but
does not lower provider-measured cost per verified success.

## Minimal API smoke

Before a coding benchmark, copy `.env.example` to the ignored `.env`, configure
`GEMINI_API_KEY` (the existing lowercase `gemini_api_key` is also accepted),
and run `node scripts/gemini-api-smoke.mjs`. The smoke loads that local file,
allows only `gemini-3.5-flash-lite`, caps output at 16 tokens, reports usage
metadata without logging credentials, and does not modify a repository. A
successful smoke proves connectivity and basic telemetry only; it is not an
effectiveness result.
