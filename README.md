# autorun-harness

A long-running agent framework that automates software development using a three-agent architecture built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk).

Give it a PRD (or a plain-text description) and it will analyze requirements, generate a technical spec, break work into tasks, and then loop through implementation and quality evaluation — all without human intervention.

## How It Works

```
┌──────────────────────────────────────────────────────────┐
│              Init Phase (runs once)                       │
│                                                          │
│   PRD / Text  →  Planner Agent  →  spec.md + tasks.json │
│                                     + project docs       │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│              Run Phase (loops per task)                   │
│                                                          │
│   Pick next task  →  Generator Agent                     │
│                          │                               │
│                     Evaluator Agent                      │
│                          │                               │
│                    ┌─────┴──────┐                        │
│                    │            │                        │
│                   pass        fail                       │
│                    │            │                        │
│              completed    retry (≤ 3×)                   │
│                              │                           │
│                        needs_human                       │
│                         (≥ 3 fails)                      │
└──────────────────────────────────────────────────────────┘
```

**Three specialized agents collaborate:**

| Agent | Role | Input | Output |
|-------|------|-------|--------|
| **Planner** | Requirement analysis, task decomposition | PRD document | `spec.md`, `tasks.json`, project docs |
| **Generator** | Feature implementation | Task + spec | Code changes via file editing tools |
| **Evaluator** | Acceptance testing, quality scoring | Task + code state | `evaluator_report.json` |

## Features

- **Two init modes** — `full` mode generates a complete doc suite (CLAUDE.md, DESIGN.md, API contracts, data models, flowcharts); `simple` mode skips docs and focuses on task decomposition
- **Automated quality evaluation** — each task is scored across four dimensions (functionality 40%, code quality 25%, product depth 20%, visual design 15%) with a 0.75 pass threshold
- **Automatic retry** — failed tasks cycle back to the Generator with evaluator feedback (up to 3 attempts before flagging for human review)
- **Multi-provider support** — pool multiple AI providers (Anthropic, OpenAI-compatible endpoints) and auto-switch on rate limits (429) or usage caps
- **Cost tracking** — token usage is recorded per agent and per task, with budget limits and warnings
- **Failure analysis** — errors are collected into `failure.md` with pattern analysis and suggested solutions
- **Graceful shutdown** — SIGTERM/SIGINT signals are caught so in-progress task state is preserved

## Quick Start

### Prerequisites

- Node.js 18+
- An AI provider configured via the `provider` command (the framework manages API keys and endpoints centrally — no manual environment variables needed):
  ```bash
  # Add your first provider
  node dist/index.js provider --add --name my-provider --token "your-token" --url "https://api.anthropic.com" --model "claude-sonnet-4-20250514"
  ```

  See [Multi-provider support](#multi-provider-support) below for details on adding providers from different AI vendors (Anthropic, ZhiPu GLM, ByteDance ARK, OpenAI-compatible endpoints, etc.) and automatic switching on rate limits.

### Install

```bash
git clone https://github.com/yamsfeer/autorun-harness.git
cd autorun-harness
npm install
npm run build
```

### Usage

**Initialize a project from a PRD:**

```bash
# Full mode — generates docs + spec + tasks
node dist/index.js init ./my-project --prd ./PRD.md

# Full mode with existing docs directory
node dist/index.js init ./my-project --prd ./PRD.md --docs ./my-project/docs

# Simple mode — just spec + tasks
node dist/index.js init ./my-project --text "Build a todo app with CRUD operations" --mode simple
```

**Run the task loop:**

```bash
# Process up to 10 tasks (default)
node dist/index.js run ./my-project

# Limit to 5 tasks with a token budget
node dist/index.js run ./my-project --max-tasks 5 --max-tokens 500000

# Continue a previously interrupted run
node dist/index.js run ./my-project --continue
```

**Manage AI providers:**

```bash
# Add a provider
node dist/index.js provider --add --name glm --token "your-token" --url "https://open.bigmodel.cn/api/anthropic" --model "GLM-4.7"

# List all providers and their status
node dist/index.js provider --list

# Switch to a specific provider
node dist/index.js provider --switch glm

# Remove a provider
node dist/index.js provider --remove glm
```

### Multi-provider support

The framework supports any Anthropic-compatible API endpoint. Provider configs are stored globally at `~/.config/autorun-harness/providers/` and are the single source of truth — the Claude Agent SDK reads provider settings from `process.env`, which the framework sets automatically.

**Supported providers include:**
- **Anthropic** — the default API
- **ZhiPu GLM** — via `https://open.bigmodel.cn/api/anthropic`
- **ByteDance ARK** — via `https://ark.cn-beijing.volces.com/api/coding`
- **OpenAI-compatible endpoints** — any service with an Anthropic-compatible API

**Automatic switching:** When a provider hits a rate limit (429) or usage cap, the framework automatically switches to the next available provider. Rate-limited providers recover after 1 hour (cooldown), and usage-capped providers recover after 24 hours — both checked on-demand rather than by timers.

## Project State

Runtime state is stored in `<project-dir>/.harness/`:

```
.harness/
├── spec.md                # Technical spec (generated by Planner)
├── tasks.json             # Task list with status and acceptance criteria
├── progress.txt           # Execution progress log
├── costs.json             # Token usage records
├── failure.md             # Error collection and pattern analysis
├── logs/                  # Structured JSON logs
├── screenshots/           # Playwright screenshots from evaluation
└── reports/               # Evaluator reports per task/attempt
    └── evaluator_report_<task-id>_<attempt>.json
```

## Task Lifecycle

```
pending → in_progress → completed
                  ↘ needs_human (after ≥ 3 failed attempts)
                  ↘ pending     (evaluation failed, retry with feedback)
```

## Architecture

```
src/
├── index.ts                    # CLI entry point (init / run / provider commands)
├── types/
│   ├── index.ts                # Core types (Task, TaskList, EvaluatorReport, etc.)
│   └── quality.ts              # Quality assurance types (Cost, Error, Provider, etc.)
├── core/
│   ├── orchestrator.ts         # Main orchestrator — coordinates the full pipeline
│   ├── state-manager.ts        # Reads/writes .harness/ state files
│   ├── evaluator.ts            # Evaluator agent wrapper
│   ├── error-handler.ts        # Error classification, retry logic, provider switching
│   ├── cost-tracker.ts         # Token usage tracking and budget enforcement
│   ├── failure-collector.ts    # Error collection and pattern analysis
│   ├── provider-manager.ts     # Multi-provider pool management
│   ├── message-handler.ts      # Filters and formats agent messages for console
│   ├── graceful-shutdown.ts    # SIGTERM/SIGINT handler
│   └── playwright-tester.ts    # Playwright utility (for web app evaluation)
├── agents/
│   ├── loader.ts               # Loads agent prompts from markdown files
│   └── index.ts                # Module exports
└── commands/
    ├── init.ts                 # init command implementation
    ├── run.ts                  # run command implementation
    └── provider.ts             # provider command implementation

prompts/
├── planner-full.md             # Planner prompt (full mode)
├── planner-simple.md           # Planner prompt (simple mode)
├── generator.md                # Generator prompt
└── evaluator.md                # Evaluator prompt
```

## Evaluation

The evaluation toolkit has been extracted into a separate project: [autorun-harness-eval](https://github.com/yamsfeer/autorun-harness-eval)

It reads `.harness/` state files and runs automated checks (build, test, lint, runtime) to score the framework's output. See the eval project's README for usage.

## Development

```bash
npm run build          # Compile TypeScript
npm run dev            # Watch mode
npm run start          # Run the CLI
npm test               # Run all tests (vitest)
npm run test:coverage  # Run tests with coverage report
```

## License

MIT
