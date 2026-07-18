# Hybrid Retrieval

The `@continuum/context-engine` pipeline combines exact symbol/path/package lookup, FTS5 lexical retrieval over compiled content and contextual headers, bounded relationship expansion, required-coverage completion, component reranking, deduplication, diversity selection, and budget-aware packing.

FTS rows carry explicit context-version and repository IDs. SQLite BM25 values retain their raw sign and use `max(0, -raw) / (1 + max(0, -raw))`; stronger negative matches therefore normalize higher. If FTS5 is unavailable, deterministic symbol, title, path, content, and token-overlap scores are used.

Every candidate exposes exact, lexical, relationship, task/risk, validity, token-cost, and duplicate components plus reasons, provenance, coverage categories, estimated tokens, backend, raw lexical score, and normalized lexical score. Current versions are favored; historical and stale versions are excluded by default. Uncommitted versions are labelled and penalized.

Semantic retrieval is optional and disabled by default through `DisabledSemanticRetriever`. No cloud API, hosted vector database, or embedding service is required.
