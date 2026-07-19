# Shadow Flight Recorder

Every Codex shadow execution is persisted in append-only ledgers: execution lifecycle, raw protocol/stderr events, normalized evidence, usage snapshots, and turn diffs. Normalized rows always reference their source raw event sequence. Updates and deletes on evidence ledgers are rejected by database triggers.

Use:

```text
continuum codex report <execution-id> --json
continuum codex status <execution-id> --json
continuum codex list --json
```

Reports reconstruct from SQLite after process restart. They separate direct evidence (App Server file-change items, diffs, commands, tests, approvals, usage, completion) from command-inferred evidence (paths parsed from commands). Unknown notifications and malformed JSON are retained as evidence rather than discarded.

The report compares persisted orientation prediction with observed exploration and includes snapshot identity, lifecycle, accumulated measured provider usage when available, experimental per-response usage when explicitly enabled and reported, estimated Continuum packet tokens, and evidence warnings.

Shadow mode does not prove provider savings, causality, complete file-read coverage, or that every repository change was caused solely by Codex. Continuum packet tokens are estimates and must not be summed with provider usage.
