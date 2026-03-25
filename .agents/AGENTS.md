# AGENTS.md – Voice Code Project Guidelines

This document provides guidelines for agentic coding agents operating in this repository.

## Project Overview

- **Project Name**: Voice Code
- **Type**: Real-time voice-to-code IDE
- **Stack**: React.js frontend (Vite), Node.js Express backend (Socket.IO), Grok API
- **Language**: Multilingual voice transcription

## Critical Rules

<!-- AI AGENTS: This section is LOCKED. Do not edit, remove, or reorder these rules without direct user approval. -->

### Documentation References

- **AGENTS.md**: https://github.com/agentsmd/agents.md
- **xAI (Grok API)**: https://docs.x.ai
- **Google Gemini**: https://ai.google.dev/gemini-api/docs
- **Groq**: https://console.groq.com/docs
- **OpenAI Agents SDK**: https://openai.github.io/openai-agents-js
- **Node.js**: https://nodejs.org/docs/latest/api

### Feature Specs

- Feature specifications live in `.agents/features/<YYYYMMDD>.<feature-name>.md` files
- Create new specs (feature planning, feature descriptions) in `.agents/features/<YYYYMMDD>.<feature-name>.md` files
- Do not create new specs without explicit user approval
- Always check this directory before implementing a new feature — a spec may already exist
- Follow the spec precisely when one is provided
- Every spec must include a granular implementation plan with checkmarks (`- [ ]` / `- [x]`) tracking each step and sub-step
- Update checkmarks and add implementation details as work progresses
- Document key decisions and tradeoffs in the spec
- Link related specs with cross-references
- Include a status line at the top: `Status: draft | in-progress | completed | reverted`
- Every spec should include: Summary, Implementation Plan (with checkmarks), and Testing

### Commit Rules

1. **Commit only when the user explicitly asks** — never auto-commit.
2. **Clean up code before every commit** — remove dead code, unused imports, debug logs, and leftover TODOs.
3. **Check for security issues and fix them before commit** — scan for hardcoded secrets, exposed credentials, injection vulnerabilities, and unsafe dependencies.
4. **Run linter before every commit** — check and fix ESLint/TypeScript errors in changed files before committing.
5. **Update AGENTS.md and README.md when completing a feature** — ensure env vars table, architecture section, file structure, and configuration docs reflect the changes.

<!-- END LOCKED SECTION -->

## Dev Environment Setup

### Environment Variables

- Store secrets in `.env` (never commit), use `.env.example` as template
- Access via `process.env` in Node.js, `import.meta.env` in Vite

| Variable                        | Values                                   | Default     | Description                                           |
|---------------------------------|------------------------------------------|-------------|-------------------------------------------------------|
| `LLM_PROVIDERS`                 | comma-separated: `xai`, `gemini`, `groq` | `xai`       | Provider list: first = primary, rest = fallbacks      |
| `XAI_API_KEY`                   | string                                   | —           | x.ai API key                                          |
| `GEMINI_API_KEY`                | string                                   | —           | Google Gemini API key                                 |
| `GROQ_API_KEY`                  | string                                   | —           | Groq API key                                          |
| `OPENAI_AGENTS_DISABLE_TRACING` | `1`                                      | `1`         | Must be `1` — SDK tracing is incompatible with Grok   |
| `TTS_MAX_LENGTH`                | number                                   | `500`       | Skip TTS for long responses                           |
| `IDE_TYPE`                      | `jetbrains`, `vscode`, `none`            | `jetbrains` | IDE integration                                       |
| `CODING_CLI`                    | `opencode`, `kiro-cli`, `none`           | `opencode`  | CLI tool for coding tasks                             |
| `EXTENSIONS`                    | comma-separated names or `none`          | `none`      | Enable extension agents                               |
| `SCHEDULED_TASKS`               | comma-separated names or `none`          | `none`      | Enable scheduled tasks                                |
| `ORCHESTRATOR_TYPE`             | `piped`, `native`                        | `piped`     | Orchestrator mode (native = xAI Realtime voice agent) |
| `PORT`                          | number                                   | `5000`      | Backend server port                                   |

### Important Gotchas

- **Grok API compatibility**: Must use Chat Completions mode (`useResponses: false`), not the OpenAI Responses API
- **Tracing**: Disabled via env var — the OpenAI Agents SDK tracing hits `platform.openai.com` which rejects Grok API keys
- **CORS**: Backend allows all origins for development
- **Audio Format**: Frontend converts microphone input to PCM16 (24kHz mono)
- **IDE agent delegates coding** to CLI FunctionTools (unless `CODING_CLI=none`, in which case it codes directly via MCP)

## Build, Lint, and Test Commands

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev       # Development server
npm run build     # Production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

### Backend (Node.js + Express)

```bash
cd backend
npm install
npm run dev       # Development server (tsx watch)
npm run build     # TypeScript compilation
npm start         # Production server
```

### Docker

```bash
docker-compose up --build
```

## Code Style Guidelines

### General Principles

1. **Declarative code, agent decisions** — all decision-making lives in agent prompts, never in application code. Code defines tools and wires agents; agents decide routing, parameters, and when to act. No `if/else` business logic in TS — tools are capabilities, agents choose when to use them.
2. **Clean, maintainable code** with proper error handling
3. **Well-documented** with clear comments for complex logic
4. **Follow existing patterns** in the codebase
5. **Use TypeScript types** in the backend

### JavaScript/React (Frontend)

- Components in `frontend/src/`, use `.jsx` extension
- Components: PascalCase, functions/variables: camelCase, constants: UPPER_SNAKE_CASE
- Functional components with hooks (`useState`, `useEffect`, `useCallback`, `useRef`)
- Clean up resources in `useEffect` return function

### TypeScript/Node.js (Backend)

**Key patterns**:
- Env vars read lazily via getter functions (not at module scope) to ensure dotenv has loaded
- Agent modules dynamically imported in `index.ts` after dotenv loads
- Shared `OpenAIProvider` via `ensureProvider()` in `agents/provider.ts`
- MCP servers spawned with full `process.env` to inherit `DISPLAY` for headed browser mode
- CLI bridges are SDK `FunctionTool` instances (`tool()` from `@openai/agents`)
- Each agent is a self-contained package under `agents/<name>/`

**Import order**:
```typescript
// Node.js built-ins first
import { createServer } from 'http';

// External libraries
import express from 'express';
import { Agent, run, tool } from '@openai/agents';
import { MCPServerStdio } from '@openai/agents';

// Local imports last
import type { BrowserResult } from '../../types/index.js';
import { ensureProvider } from '../provider.js';
```

**Error handling**:
- Use try/catch blocks for WebSocket and network operations
- Emit error events to a client via Socket.IO rather than throwing
- Log errors with descriptive messages including session IDs

### Socket.IO Events

- `transcription_result` — orchestrator output with agent prompts
- `browser_result` — `{ status, message }` from browser agent
- `ide_result` — `{ agent, status, message }` from IDE agent
- `voice_response_delta` — `{ audio }` base64 audio chunk from TTS
- `voice_response_done` — `{}` TTS finished for current response
- `set_tts_enabled` — client → server, toggle TTS on/off
- `audio_delta` — audio chunks from x.ai realtime API

## Architecture

The system uses a multi-agent architecture powered by the **OpenAI Agents SDK** (`@openai/agents`):

1. **Orchestrator Agent** (`agents/orchestrator/`) — SDK Agent with `handoff()` to browser/IDE/planner. Routes commands via SDK handoffs (no manual JSON parsing).
2. **Browser Agent** (`agents/browser/`) — Controls a Chromium browser via Playwright MCP server. Uses SDK `Agent` + `run()` with `useResponses: false` (Chat Completions mode) against the Grok API.
3. **IDE Agent** (`agents/ide/`) — Unified agent supporting JetBrains, VS Code, or no IDE. Uses SDK `Agent` + `run()` with MCP servers and `FunctionTool` CLI bridges. Behavior depends on `IDE_TYPE` and `CODING_CLI` env vars:
   - `IDE_TYPE=jetbrains|vscode` + `CODING_CLI=opencode|kiro-cli` → MCP for navigation, FunctionTool for coding (default)
   - `IDE_TYPE=jetbrains|vscode` + `CODING_CLI=none` → MCP for everything including coding
   - `IDE_TYPE=none` + `CODING_CLI=opencode|kiro-cli` → FunctionTool only, no MCP
   - `IDE_TYPE=none` + `CODING_CLI=none` → Chat-only, no tools
4. **Planner Agent** (`agents/planner/`) — Designs implementation plans for complex features before coding. Uses SDK `Agent` + `run()`.
5. **Voice Client** (`agents/voice/`) — Handles voice input/output via WebSocket (x.ai Realtime API, PCM16 audio at 24kHz mono). Native WebSocket, not an SDK Agent.

### IDE Agent Dispatch Flow

```
Voice → Transcribe → Orchestrator → IDE Agent (Grok)
                                          ↓
                                    Decides action type
                                          ↓
                          ┌───────────────┴───────────────┐
                          ↓                               ↓
                   Direct IDE action              Coding task
                   (MCP tools)                    (FunctionTool)
                   e.g. open file,                → run_opencode({ prompt })
                   search, navigate               → run_kiro({ prompt })
```

When `IDE_TYPE=none`, the MCP branch is unavailable and all tasks go to CLI FunctionTool.
When `CODING_CLI=none`, the CLI branch is unavailable and all tasks use MCP directly.

### Backend File Structure

```
backend/src/
├── index.ts                    # Bootstrap: loadEnv → imports → listen
├── server.ts                   # Express + Socket.IO setup
├── router.ts                   # Socket.IO event handlers → run(orchestrator, input, { session })
│
├── agents/
│   ├── index.ts                # buildAgentGraph() — wires handoffs, re-exports
│   ├── provider.ts             # Shared OpenAIProvider setup (ensureProvider)
│   ├── context.ts              # AppContext type for SDK RunContext
│   ├── guardrails.ts           # readOnlyGuardrail (SDK InputGuardrail)
│   │
│   ├── orchestrator/
│   │   ├── index.ts            # SDK Agent + handoffs
│   │   └── instructions.ts     # Orchestrator prompt builder
│   │
│   ├── browser/
│   │   └── index.ts            # SDK Agent + Playwright MCPServerStdio
│   │
│   ├── planner/
│   │   └── index.ts            # SDK Agent, no tools
│   │
│   ├── voice/
│   │   ├── index.ts            # Re-exports, createSTTClient, createTTSClient
│   │   ├── types.ts            # VoiceTransport (STT) interface
│   │   ├── tts-types.ts        # TTSTransport interface
│   │   ├── stt/                # Speech-to-text transports (xai, groq, gemini)
│   │   └── tts/                # Text-to-speech transports (xai, groq, gemini)
│   │
│   ├── tasks/                  # Scheduled task execution
│   │   ├── index.ts            # Re-exports
│   │   ├── registry.ts         # Task registry
│   │   ├── scheduler.ts        # Task scheduler
│   │   └── schedules.ts        # Schedule definitions
│   │
│   ├── extensions/             # Optional extension agents (auto-discovered)
│   │   ├── index.ts            # registerExtensions() — dynamic agent registration
│   │   ├── routing.ts          # Extra orchestrator routing rules
│   │   ├── tasks.ts            # Extension task definitions
│   │   ├── schedules.ts        # Extension schedule definitions
│   │   └── example/            # Example extension (disabled by default)
│   │
│   └── ide/
│       ├── index.ts            # SDK Agent factory (createIDEAgent)
│       ├── mcp/
│       │   ├── jetbrains.ts    # MCPServerStdio config for JetBrains
│       │   └── vscode.ts       # MCPServerStdio config for VS Code
│       └── tools/
│           ├── cli.ts          # CLI config + getCliFunctionTool()
│           ├── opencode.ts     # FunctionTool: run_opencode
│           ├── kiro.ts         # FunctionTool: run_kiro
│           ├── opencode-wrapper.sh
│           ├── kiro-wrapper.sh
│           └── stop.sh         # Kill script for CLI processes
│
├── core/
│   ├── index.ts                # Re-exports
│   ├── logger.ts               # Pino logger
│   ├── config.ts               # Env loading, validation, getXAIConfig, getAgentsMd
│   ├── providers.ts            # Shared provider setup
│   ├── session.ts              # SessionStore (UI) + AgentSession (SDK Session)
│   └── interrupt.ts            # AbortController registry, stop detection
│
├── routes/
│   └── settings.ts             # REST endpoint (uses core/config)
│
└── types/
    └── index.ts                # Shared types
```

### Dependency Flow

```
core/  ←──  agents/  ←──  router.ts  ←──  index.ts
  ↑                          ↑
  └──── routes/settings.ts ──┘
        server.ts ───────────┘
```

- `core/` imports nothing from `agents/` or `router.ts`
- `agents/` imports from `core/` only
- `router.ts` imports from `agents/` and `core/`
- `index.ts` wires everything together

## Dependencies

**Frontend**: React 19, Vite, Socket.IO-client, Axios
**Backend**: Express, Socket.IO, ws, OpenAI Agents SDK (`@openai/agents`), OpenAI client (`openai`), Playwright, MCP SDK, dotenv, zod

## Git Workflow

This project uses a two-remote setup with a branching strategy for private extensions.

### Repository Layout

- `upstream` — community public repo (`voice-code`)
- `origin` — private repo (`voice-code-private`)
- `main` branch — community code, synced to both remotes
- `extensions` branch — private extensions, pushed to `origin` only

### What Goes Where

| Change type                                      | Branch       | Push to               | Example                                        |
|--------------------------------------------------|--------------|-----------------------|------------------------------------------------|
| Core agents, shared tools, bug fixes             | `main`       | `upstream` + `origin` | `agents/orchestrator/`, `agents/ide/`, `core/` |
| Extension agents, private routing, private tasks | `extensions` | `origin` only         | `agents/extensions/your-agent/`                |
| Auto-discovery hooks (added once)                | `main`       | `upstream` + `origin` | `try { import('./extensions/...') } catch {}`  |
| Docs (README, AGENTS.md)                         | `main`       | `upstream` + `origin` | —                                              |

### Rules for the `extensions/` Directory

- `agents/extensions/index.ts`, `routing.ts`, `example/` — **community code** on `main`, pushed to both remotes
- Any new agent directories under `extensions/` (e.g. `extensions/my-agent/`) — **private code** on `extensions` branch, pushed to `origin` only
- `extensions/tasks.ts`, `extensions/schedules.ts` — exist on both branches; a community version has empty placeholders, `extensions` branch has actual entries
- **Never modify community files on the `extensions` branch** — only add files in `agents/extensions/`

### Commit Workflow

**When working on community code (on `main`):**
```bash
git checkout main
# ... make changes to core agents, shared code, docs ...
git add -A && git commit -m "feat: description"
git push upstream main
git push origin main
```

**When working on private extensions (on `extensions`):**
```bash
git checkout extensions
# ... add/modify files ONLY in agents/extensions/ ...
git add -A && git commit -m "feat(ext): description"
git push origin extensions
# NEVER push extensions branch to upstream
```

**After community updates land on `main`:**
```bash
git checkout main
git pull upstream main
git push origin main
git checkout extensions
git rebase main
git push origin extensions --force-with-lease
```

### Conflict Prevention

1. Extension code lives **only** in `agents/extensions/` — never edit shared files on the `extensions` branch
2. Community auto-discovery hooks use `try/catch` dynamic `import()` — they silently skip when extensions are absent
3. The orchestrator prompt is composable — extensions inject routing via `InstructionParts`, never edit the base prompt
4. Rebase (not merge) `extensions` onto `main` to keep linear history
