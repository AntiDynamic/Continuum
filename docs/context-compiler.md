# Context Compiler

Continuum compiles parsed repository structures into version-aware context items. Each item is the exact extracted source preceded by a deterministic header containing repository, package, path, symbol, kind, parent, evidence-backed purpose, verified tests/imports, snapshot state, staleness, and provenance.

Purpose text comes only from JSDoc, leading comments, symbol names, or package metadata. Unknown purpose is labelled explicitly. The compiler hashes compiled content and the source file, stores source lines and snapshot identity, and never uses an LLM.

Supported inputs are TypeScript/JavaScript/TSX/JSX, coherent Markdown sections, nested JSON/YAML configuration sections, and statement-level SQL. SQL without a confidently recognized declaration is retained with medium parse confidence. Continuum does not claim semantic type resolution or a complete call graph.

Repository constraints are extracted only from authoritative repository documentation such as `AGENTS.md`, `README.md`, `SECURITY.md`, and the architecture/privacy/limitations guides. They remain repository data and never become agent or system instructions.
