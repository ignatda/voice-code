# Voice Code

Real-time voice-to-code IDE powered by a multi-agent architecture. Speak commands in any language — the system transcribes, routes, and executes them across browser, IDE, and planning agents.

## Quick Start

```bash
# 1. Configure environment
cp .env.example backend/.env
# Edit backend/.env — set your OPENAI_API_KEY (x.ai key)

# 2. Start with Docker
docker-compose up --build

# Or start manually:
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173` in your browser.

## Architecture

```
Voice → Transcribe → Orchestrator → Browser Agent  (Playwright MCP)
                                   → IDE Agent      (JetBrains/VS Code MCP + CLI)
                                   → Planner Agent  (design before code)
                                   → Extensions     (optional, user-defined agents)
```

All agents use the [OpenAI Agents SDK](https://github.com/openai/openai-agents-js) with `useResponses: false` for Grok API compatibility.

## Configuration

Settings are managed via environment variables (`.env`) or the Settings UI at runtime.

| Variable | Values | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | string | — | x.ai API key (required) |
| `OPENAI_BASE_URL` | URL | `https://api.x.ai/v1` | LLM API endpoint |
| `OPENAI_MODEL` | string | `grok-4-1-fast-non-reasoning` | Model name |
| `IDE_TYPE` | `jetbrains`, `vscode`, `none` | `jetbrains` | IDE integration |
| `CODING_CLI` | `opencode`, `kiro-cli`, `none` | `opencode` | CLI tool for coding tasks |
| `EXTENSIONS` | comma-separated names or `none` | `none` | Enable extension agents |
| `PORT` | number | `5000` | Backend server port |

## Extensions

Extensions are optional agents that plug into the orchestrator without modifying core code. They live in `backend/src/agents/extensions/` and are disabled by default.

### How it works

1. The orchestrator auto-discovers extensions at startup via dynamic `import()`.
2. Extensions are only loaded when listed in the `EXTENSIONS` env var.
3. Each extension registers its agent and routing rules into the agent graph.
4. The orchestrator prompt is composable — extensions inject their routing rules without editing the base prompt.

### Enabling extensions

Set the `EXTENSIONS` env var to a comma-separated list of extension names:

```bash
# Enable the example extension
EXTENSIONS=example

# Enable multiple
EXTENSIONS=agent-x,agent-y

# Disable all (default)
EXTENSIONS=none
```

Or toggle via the Settings UI in the browser.

### Creating an extension

1. Create a directory under `backend/src/agents/extensions/your-agent/`
2. Export an SDK `Agent` from `index.ts`
3. Register it in `extensions/index.ts` inside `registerExtensions()`
4. Add routing rules in `extensions/routing.ts`
5. Set `EXTENSIONS=your-agent` to enable

See `extensions/example/` for a working template.

### Example extension

The `example` extension is a minimal agent that echoes input back. It's hidden from the orchestrator by default and serves as a starting point:

```bash
EXTENSIONS=example  # enable it
EXTENSIONS=none     # disable it (default)
```

## Agents

| Agent | Role | Tools |
|---|---|---|
| Orchestrator | Routes commands, translates input | `translate_to_english`, handoffs |
| Browser | Web browsing and page interaction | Playwright MCP |
| IDE | Code editing, navigation, commands | JetBrains/VS Code MCP + CLI |
| Planner | Design implementation plans | None (chat only) |
| Voice | Voice input/output (PCM16 24kHz) | x.ai Realtime API |

## Development

```bash
# Backend
cd backend
npm run dev       # Dev server (tsx watch)
npm run build     # TypeScript compilation

# Frontend
cd frontend
npm run dev       # Vite dev server
npm run build     # Production build
npm run lint      # ESLint
```

## Project Structure

```
├── backend/src/
│   ├── agents/           # Agent implementations
│   │   ├── orchestrator/ # Command routing
│   │   ├── browser/      # Playwright browser control
│   │   ├── ide/          # IDE integration (MCP + CLI)
│   │   ├── planner/      # Implementation planning
│   │   ├── voice/        # Voice I/O (WebSocket)
│   │   └── extensions/   # Optional extension agents
│   ├── core/             # Config, logging, sessions
│   ├── routes/           # REST endpoints
│   └── types/            # Shared TypeScript types
├── frontend/src/         # React UI
├── docker-compose.yml
└── AGENTS.md             # Guidelines for AI coding agents
```

## Code Style Guidelines

### Core Principle: Declarative Code, Agent Decisions

All decision-making lives in agent prompts, never in application code. Code defines tools and wires agents; agents decide routing, parameters, and when to act. No `if/else` business logic in TS — tools are capabilities, agents choose when to use them.

### Conventions

- **Frontend**: React functional components (`.jsx`), PascalCase components, camelCase functions
- **Backend**: TypeScript, env vars read lazily via getters, agents are self-contained packages under `agents/<name>/`
- **Imports**: Node.js built-ins → external libraries → local imports
- **Error handling**: try/catch for network ops, emit errors via Socket.IO, log with session IDs
- **Env vars**: secrets in `.env` (never commit), template in `.env.example`

See [AGENTS.md](AGENTS.md) for detailed guidelines.

## Setting Up an Extensions Fork

To maintain private extensions that stay in sync with the community repo:

1. Create a new private repo on GitHub (empty, no README).

2. Set up two remotes and an extensions branch:

```bash
cd voice-code

# Rename community remote to "upstream"
git remote rename origin upstream

# Add your private repo as "origin"
git remote add origin https://github.com/<your-org>/<your-private-repo>.git

# Push main to private repo
git push -u origin main

# Create and push the extensions branch
git checkout -b extensions
git push -u origin extensions
git checkout main
```

3. Verify:

```bash
git remote -v
# origin    https://github.com/<your-org>/<your-private-repo>.git (fetch/push)
# upstream  https://github.com/<original-org>/voice-code.git (fetch/push)

git branch -a
# * main
#   extensions
#   remotes/origin/main
#   remotes/origin/extensions
#   remotes/upstream/main
```

### Daily Workflow

- `main` branch — community code, push to both remotes
- `extensions` branch — private extensions, push to `origin` only, rebase on `main`

```bash
# Pull community updates
git checkout main && git pull upstream main && git push origin main
git checkout extensions && git rebase main && git push origin extensions --force-with-lease

# Push community contributions
git checkout main && git push upstream main && git push origin main
```

## License

This project is licensed under the [MIT License](LICENSE).
