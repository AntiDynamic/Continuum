# MCP Context Tools

The stdio MCP server is a thin interface over `@continuum/context-engine` and emits no non-protocol stdout.

- `continuum_search_context`: structured ranked candidates, content, provenance, validity, score components, reasons, and coverage.
- `continuum_get_context_packet`: orientation, implementation, metadata-only escalation, budget, omissions, and coverage.
- `continuum_explain_context_item`: one repository-scoped version by ID.
- `continuum_get_context_coverage`: task analysis and covered/missing categories.
- `retrieve_context`: compatibility alias for packet retrieval.

Optional paths must remain inside the configured Git repository. Repository constraints are returned as repository data and remain separate from agent/system instructions.

## Progressive context tools

The stdio server exposes `continuum_start_context_session`, `continuum_get_context_session`, `continuum_get_initial_context`, `continuum_request_context`, `continuum_report_context_signal`, `continuum_get_context_session_report`, `continuum_complete_context_session`, and `continuum_list_context_sessions`. All use the same repository-scoped application service as the CLI. Signal inputs are discriminated and strict. Sessions from other repositories are not visible. Existing `retrieve_context` compatibility remains available.
