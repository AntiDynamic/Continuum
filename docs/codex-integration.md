# Codex App Server integration

Continuum Phase 4A integrates the installed Codex App Server through its documented stdio JSONL transport. The tested environment is Codex CLI 0.133.0 and the stable generated schema bundle is vendored in `packages/codex-app-server/schema/0.133.0`. Regenerate it with `codex app-server generate-json-schema --out <directory>` and review the manifest and schema fingerprint before updating the supported range.

## Shadow execution

Run `continuum init`, `continuum index`, then:

```text
continuum codex "Fix the failing add function test" --mode shadow --json
```

Shadow is observation only: Continuum creates and persists its predicted orientation packet before the Codex turn, but sends Codex only the original task. It does not inject, restrict, replace, or claim to optimize Codex context. Assist mode is intentionally unavailable in Phase 4A.

The command supports `--model`, `--approval-policy`, `--sandbox`, `--timeout`, `--report`, and `--json`. Default noninteractive approval handling declines command and file-change requests. TTY users may explicitly accept, accept for the session, decline, or cancel.

## Protocol and authentication

The client performs `initialize`, sends `initialized`, reads `account/read`, starts/resumes threads, starts/interrupts turns, correlates IDs, handles server requests, and records JSONL stdout separately from stderr. Account state records whether authentication is present without persisting credentials. If authentication is missing, run `codex login` and retry.

On Windows, npm `.cmd` launchers are executed through their trusted package Node entrypoint rather than through a shell. This preserves stdio and avoids shell argument interpolation.

`--experimental-raw-usage` explicitly opts into `capabilities.experimentalApi`; it is off by default. The stable 0.133.0 schema’s accumulated `thread/tokenUsage/updated` notification remains the default measured usage source. Experimental raw-response evidence is kept separate and is never treated as accumulated usage or a savings claim.
