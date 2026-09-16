# Codex App Server integration

Continuum Phase 4A integrates the installed Codex App Server through its documented stdio JSONL transport. The tested environment is Codex CLI 0.133.0 and the stable generated schema bundle is vendored in `packages/codex-app-server/schema/0.133.0`. Regenerate it with `codex app-server generate-json-schema --out <directory>` and review the manifest and schema fingerprint before updating the supported range.

## Shadow execution

Run `continuum init`, `continuum index`, then:

```text
continuum codex "Fix the failing add function test" --mode shadow --json
```

Shadow is observation only: Continuum creates and persists its predicted orientation packet before the Codex turn, but sends Codex only the original task. It does not inject, restrict, replace, or claim to optimize Codex context. Assist mode additionally exposes the persisted context request tool and recovery envelope.

The command supports `--model`, `--approval-policy`, `--sandbox`, `--timeout`, `--report`, and `--json`. Default noninteractive approval handling declines command and file-change requests. TTY users may explicitly accept, accept for the session, decline, or cancel.

## Native automatic compaction

Every Continuum Codex execution supplies a compact recovery instruction containing the session ID, task, coverage remaining, blockers, next action, and active paths. The source contents are not copied into the compaction prompt; they remain in the persisted Continuum session and can be requested again in assist mode.

Codex's native automatic compaction remains in control of when compaction occurs. To set an explicit threshold, use:

```text
continuum codex "Fix the failing test" --mode assist --auto-compact-tokens 120000 --auto-compact-scope body_after_prefix
```

The supported scopes are `total` and `body_after_prefix`. Omitting the threshold keeps Codex's provider default while still installing the Continuum recovery prompt. Compaction notifications are retained in the raw and normalized ledgers and are exposed as `report.compaction`.

## Protocol and authentication

The client performs `initialize`, sends `initialized`, reads `account/read`, starts/resumes threads, starts/interrupts turns, correlates IDs, handles server requests, and records JSONL stdout separately from stderr. Account state records whether authentication is present without persisting credentials. If authentication is missing, run `codex login` and retry.

On Windows, npm `.cmd` launchers are executed through their trusted package Node entrypoint rather than through a shell. This preserves stdio and avoids shell argument interpolation.

`--experimental-raw-usage` explicitly opts into `capabilities.experimentalApi`; it is off by default. The stable 0.133.0 schema’s accumulated `thread/tokenUsage/updated` notification remains the default measured usage source. Experimental raw-response evidence is kept separate and is never treated as accumulated usage or a savings claim.
