# CLI

The `continuum session` group provides `start`, `status`, `context`, `request`, `signal`, `report`, `complete`, and `list`.

Use `--json` for stable machine contracts. Start accepts `--budget-tokens`, `--run <id|latest>`, `--initial-context`, and `--repo`. Request accepts repeatable `--symbol`, `--path`, and `--coverage`. List accepts `--status`, `--limit`, and `--repo`.

Signals are strict: test failures require `--tests` and `--error`; missing coverage requires `--coverage`; out-of-scope modifications require both `--modified` and `--predicted`. Normal validation failures are concise and never print stack traces.
