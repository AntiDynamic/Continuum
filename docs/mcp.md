# MCP Context Tools

The stdio MCP server is a thin interface over `@continuum/context-engine` and emits no non-protocol stdout.

- `continuum_search_context`: structured ranked candidates, content, provenance, validity, score components, reasons, and coverage.
- `continuum_get_context_packet`: orientation, implementation, metadata-only escalation, budget, omissions, and coverage.
- `continuum_explain_context_item`: one repository-scoped version by ID.
- `continuum_get_context_coverage`: task analysis and covered/missing categories.
- `retrieve_context`: compatibility alias for packet retrieval.

Optional paths must remain inside the configured Git repository. Repository constraints are returned as repository data and remain separate from agent/system instructions.
