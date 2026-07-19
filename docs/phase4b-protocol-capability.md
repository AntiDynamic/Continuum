# Phase 4B Protocol Capability Spike

## Installed Codex Version
`codex-cli 0.133.0`

## Schema Inspection

### Stable Schema
The stable schema does **not** include `dynamicTools` in `ThreadStartParams`. It does include the `config` field for thread-scoped configuration.

### Experimental Schema
The experimental schema explicitly supports:
- `dynamicTools` array in `ThreadStartParams` (via `DynamicToolSpec`)
- `item/tool/call` server request (via `DynamicToolCallParams`)
- `config` field in `ThreadStartParams`

## Dynamic Tool Support
**Supported.** Dynamic tools are fully supported when using the experimental API. 

## MCP Fallback Support
**Supported.** The `config` object is available on `thread/start`, which would allow thread-scoped local MCP server configuration if needed.

## Transport Decision
**Chosen Transport:** `native App Server dynamic tool bridge`

Because the installed version-matched experimental schema explicitly supports both `dynamicTools` and `item/tool/call`, we will use the preferred native dynamic tool bridge. We will pass experimental flags during initialization/thread start to enable this capability.
