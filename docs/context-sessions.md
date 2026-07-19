# Context sessions

Progressive context sessions deliver a small initial packet and add evidence only when a coding agent requests it or reports a typed signal.

```powershell
continuum session start "Fix authentication timeout" --budget-tokens 8000 --initial-context
continuum session status <session-id>
continuum session context <session-id>
continuum session request <session-id> "Show the timeout implementation" --symbol AuthService.refreshToken
continuum session signal <session-id> --type test-failure --tests startup-timeout.test.ts --error "Expected timeout event"
continuum session report <session-id>
continuum session complete <session-id> --status completed
```

A session is bound to one canonical repository and the exact indexed commit/worktree snapshot. If repository state changes, run `continuum index` and start a new session. Initial context is idempotent: repeated calls return persisted delivery evidence.

All JSON commands use `schemaVersion: "continuum.context-session.v1"`; reports use `continuum.context-session-report.v1`.

## Phase 3C acceptance

Standalone child-process and actual MCP stdio acceptance verifies persisted session identity, snapshot consistency, idempotent initial delivery, content-hash duplicate suppression, signals, reports, completion, and post-completion rejection. Run pnpm test:acceptance.

## Phase 3D initial delivery policy

Session initial delivery uses the same production packet builder as CLI retrieval and MCP. Its normal hard ceiling is 1,900 estimated tokens, with reserved mandatory coverage and a 250-token optional-context ceiling. Coverage evidence persists explicit required, recommended, not-applicable, or unavailable state, matching indexed candidate count, selected item IDs, remaining requirements, and any additional estimated budget needed. Oversized mandatory evidence never silently exceeds the ceiling; the packet is marked incomplete.
