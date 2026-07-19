# Shadow Flight Recorder — v2

Every Codex shadow execution is persisted in append-only ledgers: execution lifecycle, raw protocol/stderr events, normalized evidence, usage snapshots, and turn diffs. Normalized rows always reference their source raw event sequence. Updates and deletes on evidence ledgers are rejected by database triggers.

## Schema version

`continuum.shadow-flight-recorder.v2` (current)

`continuum.shadow-flight-recorder.v1` — deprecated; fields `directlyObservedPaths`, `changedPaths`, `inferredPaths`, `overlapRecall`, `overlapPrecision` are kept as aliases for backward compatibility.

## Evidence model

Evidence is separated into distinct buckets with honest labels:

| Field | Source | Semantics |
|---|---|---|
| `editedPaths` | `fileChange` items | Files Codex modified |
| `diffPaths` | `turn/diff/updated` | Files appearing in turn diff |
| `commandInferredReadPaths` | Shell command arguments (non-search) | Paths Codex may have read — not proven |
| `searchedPaths` | Shell search commands (rg, grep) | Paths searched |
| `searchedSymbols` | Shell rg/grep command arguments | Symbols searched |
| `testRelatedPaths` | Test command arguments | Paths in test commands |
| `directlyObservedReadPaths` | (Codex App Server schema v0.133.0) | Always empty — the schema does not expose direct file-read events |

## Comparison metrics

- **`observationRecall`** = `|overlap| / |observed|` — of what was observed, what fraction was predicted?
- **`predictionPrecision`** = `|overlap| / |predicted|` — of what was predicted, what fraction was observed?

> Observed = editedPaths ∪ commandInferredReadPaths ∪ searchedPaths ∪ diffPaths

> Predicted = orientation delivery items

## Prediction items

Each `prediction.items[i].requirementState` accurately reflects the `requiredCoverage` state from task analysis:
- `"required"` — only when the task analysis marks the coverage category as required
- `"recommended"` — when recommended but not required
- `"not_applicable"` — default when no matching coverage requirement

`prediction.items[i].mandatory` is `true` only when `requirementState === "required"`.

## Snapshot integrity

The final snapshot stored on a failed run is:
1. The actual git state, if resolvable after failure
2. The session starting snapshot (preserved from session creation), if git resolution fails
3. `"SNAPSHOT_UNAVAILABLE"` (only if session data is also unavailable — extremely rare)

A repository database integer ID is never used as a commit hash.

## CLI

```text
continuum codex report <execution-id> --json
continuum codex status <execution-id> --json
continuum codex list --json
```

Reports reconstruct from SQLite after process restart. Unknown notifications and malformed JSON are retained as evidence rather than discarded.

## Limitations

Shadow mode does not:
- Inject Continuum prediction content into Codex
- Prove provider token savings, causality, or complete file-read coverage
- Guarantee every repository change was caused solely by Codex
- Expose actual file reads (Codex App Server schema v0.133.0 does not emit read events)

Continuum packet tokens are estimates and must not be summed with provider usage.
