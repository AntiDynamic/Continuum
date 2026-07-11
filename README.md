# Continuum

**Vendor-neutral context observability and optimisation system for AI coding agents.**

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/AntiDynamic/Continuum)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## What is Continuum?

Continuum wraps AI coding agents — such as Gemini CLI, Antigravity, Codex and Claude Code — and measures what they do.

It does not replace coding agents.  It observes them.

The long-term goal:

> Find the smallest reliable project context that allows a coding agent to complete a software task correctly, safely and efficiently.

V1 is the observation and evidence foundation.  It collects trustworthy raw data that future optimisation can use.

---

## What Continuum is NOT

- ❌ Another coding agent
- ❌ A repository chatbot
- ❌ A vector-search application
- ❌ A replacement for Gemini CLI or any other agent
- ❌ A generic note-taking memory system
- ❌ A simple token-count dashboard
- ❌ A system that reads the model's internal attention
- ❌ A reinforcement-learning system in V1

---

## Current Milestone: Observer V1

Observer V1 supports:

```bash
continuum doctor
continuum init
continuum run "Fix the failing factorial test"
continuum report latest
continuum outcome latest
continuum compare <run-a> <run-b>
```

---

## Installation

### Prerequisites

- Node.js ≥ 18
- pnpm ≥ 8
- Git ≥ 2.x
- Gemini CLI (`npm install -g @google/gemini-cli@latest`)

### Install and build

```bash
git clone https://github.com/AntiDynamic/Continuum.git
cd Continuum
pnpm install
pnpm build

# Link the CLI globally
cd apps/cli
npm link
```

---

## Setup

Navigate to any Git repository you want to observe:

```bash
cd /path/to/your-project
continuum init
```

This creates `.continuum/` with:
- `config.json` — configuration
- `continuum.db` — SQLite database
- `runs/` — test output files

---

## Commands

### `continuum doctor`

Check your environment — Node.js, Git, Gemini CLI, database access, and repository status.

```
PASS  Node.js v24.13.0
PASS  Git 2.48.1
PASS  Gemini CLI 0.50.0
PASS  Gemini stream-json output — supported
PASS  SQLite (better-sqlite3)
```

### `continuum init`

Initialise Continuum in the current repository. Detects test commands, creates `.continuum/`, and optionally updates `.gitignore`.

```bash
continuum init
continuum init --non-interactive  # use defaults without prompts
```

### `continuum run "<task>"`

Execute a coding agent task and record all observable evidence.

```bash
continuum run "Fix the failing factorial test"
continuum run --agent gemini --timeout 5m "Refactor the authentication module"
continuum run --skip-baseline-tests "Add type annotations to calculator.ts"
```

**Flags:**
- `--agent <id>` — Agent adapter (default: `gemini`)
- `--repo <path>` — Repository path (default: current directory)
- `--timeout <duration>` — Timeout (e.g. `5m`, `300s`)
- `--skip-baseline-tests` — Skip pre-run tests
- `--skip-final-tests` — Skip post-run tests
- `-- <args>` — Additional arguments forwarded to the agent

### `continuum report [run-id|latest]`

Display an evidence-based report:

```
Task                           Fix the failing factorial test
Agent                          gemini
Status                         completed
Duration                       1m 23s                          [exact]
Files changed                  1                               [derived]
Lines added                    1                               [derived]
Input tokens                   unavailable
Tool calls                     3                               [exact]
```

Metrics are labelled: **exact**, **derived**, **estimated**, **heuristic**, or **unavailable**.

### `continuum outcome [run-id|latest]`

Record your assessment of the run:

```
1. accepted
2. accepted-with-corrections
3. rejected
4. unknown
```

Also records: corrections required, regression observed, unrelated modifications, notes.

### `continuum compare <run-a> <run-b>`

Compare two runs across separate categories — no misleading single score:

```
Correctness
─────────────────────────────────────────
  Completion status    completed    completed
  Final tests          passed       failed

Efficiency
─────────────────────────────────────────
  Duration             1m 23s       2m 45s

Summary: Run A has stronger correctness evidence. No overall winner can be determined.
```

---

## Example Report

```
Continuum Report
Run: 3f7a9c12-...

Task
  Fix the failing factorial test without changing unrelated formatting behaviour.

Agent
  Agent                          gemini
  Output mode                    stream-json

Status
  Status                         completed
  Branch                         main
  Starting commit                abc1234
  Duration                       1m 23s                    [exact]

Final tests
  PASS  pnpm test — 8 passed

File changes
  Files changed                  1                         [derived]
  Lines added                    1                         [derived]
  modif  src/calculator.ts     +1  -1  [high]

Metrics
  Duration                       1m 23s                    [exact]
  Exit code                      0                         [exact]
  Files changed                  1                         [derived]
  Tool calls                     3                         [exact]
  Input tokens                   unavailable
  Output tokens                  unavailable

Unavailable metrics:
  Input tokens
  Files read by agent
  Model API calls

Warnings
  No user outcome recorded. Run 'continuum outcome' to label this run.
```

---

## Privacy Model

Continuum is a **local-first** developer tool.

- All data is stored in `.continuum/continuum.db` in your repository.
- No data is uploaded to any server.
- Raw agent output is redacted before storage (API keys, bearer tokens, private keys).
- `.continuum/` is automatically added to `.gitignore` during `init`.
- Redaction is best-effort regex-based and **cannot guarantee removal of every secret**.

**Do not store sensitive repositories where you would not run any local tool.**

---

## Evidence Model

Continuum measures only externally observable behaviour:

| Observable | How |
|------------|-----|
| Git state before/after | `git status --porcelain=v2`, `git diff --numstat` |
| File changes | Git diff |
| Test results | Child process exit code + stdout parsing |
| Agent events | `gemini --output-format stream-json` |
| Token usage | Parsed from `usage` events when present |
| Tool calls | Parsed from `tool_call` events |
| User outcome | Recorded interactively |

Continuum **cannot** observe:
- Which files the model internally attended to
- The model's reasoning process
- API billing information
- Tool calls not emitted by the CLI

---

## Known Limitations

See [docs/limitations.md](docs/limitations.md) for the complete list.

---

## Roadmap

### V2: Repository Indexing
- Tree-sitter based code structure indexing
- Git-history analysis
- Context items with provenance

### V3: MCP Context Server
- Local MCP context server
- Context packets with staleness tracking
- Previous successful/failed episodes

### V4: Adaptive Context
- Context budget selection
- Ablation testing
- Reward signals

### V5: Dashboard
- React + Vite dashboard
- Run history visualisation
- Context quality comparisons

---

## Contributing

1. Fork the repository
2. Run `pnpm install && pnpm build && pnpm test`
3. Create a feature branch
4. Implement with tests
5. Open a pull request

**Requirements:**
- Strict TypeScript — no `any` without documentation
- Tests for new logic
- No fake metrics
- No unsupported performance claims
- Cross-platform (Windows, macOS, Linux)

---

## Windows Notes

Continuum is developed and tested on Windows (PowerShell).

- Use forward slashes in configuration paths
- `gemini` resolves via `%PATH%`
- Process cancellation uses `SIGTERM` via execa

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for a complete description of the adapter system, run lifecycle, event model, and database design.
