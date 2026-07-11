# Continuum Observer Architecture

Continuum sits *around* coding agents, not between them and the language model. It acts as an observer, capturing telemetry from the agent's output and the developer's repository.

## Components

The architecture is broken into modular packages within a monorepo structure:

- **`@continuum/cli`**: The user-facing command line interface, handling arguments, output, and triggering the orchestrator.
- **`@continuum/agent-core`**: The main orchestration engine. It manages the lifecycle of an agent run, coordinating the agent adapter, test executor, and git analyzer.
- **`@continuum/shared`**: Common types, models, error definitions, and utility functions (such as redaction and logging) used across the workspace.
- **`@continuum/gemini-adapter`**: A specific implementation of the `AgentAdapter` interface that interacts with the Google Gemini CLI, capturing its JSONL stream and standardizing it into `AgentEvent` records.
- **`@continuum/database`**: The data access layer. It uses synchronous SQLite (`node:sqlite`) to persist agent events, run metadata, git snapshots, user outcomes, and test results.
- **`@continuum/git-analyzer`**: Provides read-only git interaction (via `execa`) to capture snapshots, extract diffs, compute file changes, and establish baseline states for attribution confidence.
- **`@continuum/evaluator`**: Analyzes the raw database records and produces high-level reports detailing agent performance, token usage, file changes, and test outcomes.

## Execution Flow

1. **Initialization (`continuum init`)**: Creates the `continuum.yaml` configuration and initializes the local SQLite database in `.continuum/continuum.db`.
2. **Run Orchestration (`continuum run`)**:
   - The orchestrator takes a natural language task.
   - It captures a **pre-run git snapshot**.
   - It executes a **baseline test run** to determine the current state of tests.
   - It instantiates the **Gemini Adapter**, piping the task to the agent and listening for stdout/stderr streams.
   - Events (messages, tool uses, file writes) are streamed into the database in real-time.
   - Upon completion or failure, a **post-run git snapshot** is taken.
   - It executes a **validation test run** to see if the agent's changes broke or fixed tests.
3. **Outcome Capture (`continuum outcome`)**: The developer explicitly grades the agent's work (`accepted`, `rejected`, `modified`).
4. **Reporting (`continuum report`)**: The evaluator queries the database and generates a structured summary of the agent's actions, costs, and efficacy.

## Database Schema

Continuum uses a relational SQLite schema optimized for event-sourcing and analysis:

- `repositories`: Tracking unique canonical paths.
- `agent_runs`: The primary entity, representing a single agent execution.
- `agent_events`: Ordered event stream (JSON lines) capturing every action.
- `git_snapshots`: Repository state before and after the run.
- `file_changes`: Specific files modified during the run.
- `test_runs`: Baseline and validation test outcomes.
- `usage_metrics`: Resource consumption (tokens, time).
- `user_outcomes`: Developer feedback on the run.

## Security and Privacy

- **Local First**: Continuum runs entirely locally. Data is stored in the `.continuum` directory and is never sent to external servers by Continuum itself.
- **Redaction**: A streaming redaction pipeline obfuscates API keys, access tokens, and sensitive strings before they hit the local SQLite database or the console.
- **Read-Only Git**: Continuum's git operations are strictly read-only. It observes the agent's modifications but never alters user files, checks out branches, or commits code.
