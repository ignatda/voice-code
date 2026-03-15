# AGENTS.md - Voice Code Project Guidelines

This document provides guidelines for agentic coding agents operating in this repository.

## Project Overview

- **Project Name**: Voice Code
- **Type**: Real-time voice-to-code IDE
- **Stack**: React.js frontend (Vite), Node.js Express backend (Socket.IO), Grok API
- **Language**: English and Russian voice transcription

## Architecture

The system uses a multi-agent architecture powered by the **OpenAI Agents SDK** (`@openai/agents`):

1. **Orchestrator Agent** — Analyzes transcribed speech, translates to English, and routes commands to specialized agents via the OpenAI `chat.completions` API.
2. **Browser Agent** — Controls a Chromium browser via Playwright MCP server. Uses the OpenAI Agents SDK with `useResponses: false` (Chat Completions mode) against the Grok API.
3. **IDE Agent** — Controls IntelliJ IDEA via JetBrains MCP server. Same SDK configuration as the Browser Agent.
4. **x.ai Realtime API** — Handles voice input/output via WebSocket (PCM16 audio at 16kHz mono).

## Technology Stack

- **AI Framework**: OpenAI Agents SDK v0.7+ (`@openai/agents`) — configured with `useResponses: false` for Grok API compatibility
- **LLM Provider**: Grok API (https://docs.x.ai)
    - API key configured via `OPENAI_API_KEY` in `.env`
    - Base URL: `https://api.x.ai/v1`
    - Tracing disabled via `OPENAI_AGENTS_DISABLE_TRACING=1` (incompatible with Grok)
- **Frontend**: React 19 with Vite
- **Backend**: Node.js Express with Socket.IO, TypeScript
- **Real-time Communication**: WebSocket (x.ai Realtime API)
- **Browser Control**: Playwright MCP Server (`@playwright/mcp`)
- **IDE Integration**: JetBrains MCP Server (IntelliJ IDEA)
- **Containerization**: Docker with docker-compose

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

1. **Clean, maintainable code** with proper error handling
2. **Well-documented** with clear comments for complex logic
3. **Follow existing patterns** in the codebase
4. **Use TypeScript types** in backend

### JavaScript/React (Frontend)

- Components in `frontend/src/`, use `.jsx` extension
- Components: PascalCase, functions/variables: camelCase, constants: UPPER_SNAKE_CASE
- Functional components with hooks (`useState`, `useEffect`, `useCallback`, `useRef`)
- Clean up resources in `useEffect` return function

### TypeScript/Node.js (Backend)

**File Structure**:
- Main application: `backend/src/index.ts`
- Agents: `backend/src/agents/` (browser.ts, ide.ts, orchestrator.ts)
- Types: `backend/src/types/`
- Realtime client: `backend/src/xai-realtime.ts`

**Key patterns**:
- Env vars read lazily via getter functions (not at module scope) to ensure dotenv has loaded
- Agent modules dynamically imported in `index.ts` after dotenv loads
- `OpenAIProvider` configured with `useResponses: false` for Grok compatibility
- MCP servers spawned with full `process.env` to inherit `DISPLAY` for headed browser mode

**Imports**:
```typescript
// Node.js built-ins first
import { createServer } from 'http';

// External libraries
import express from 'express';
import { Agent, run, setDefaultModelProvider, OpenAIProvider } from '@openai/agents';
import { MCPServerStdio } from '@openai/agents';

// Local imports last
import type { BrowserResult } from '../types';
```

**Error Handling**:
- Use try/catch blocks for WebSocket and network operations
- Emit error events to client via Socket.IO rather than throwing
- Log errors with descriptive messages including session IDs

### Shared Conventions

**Environment Variables**:
- Store secrets in `.env` (never commit)
- Use `.env.example` for template
- Access via `process.env` in Node.js, `import.meta.env` in Vite

**Socket.IO Events**:
- `transcription_result` — orchestrator output with agent prompts
- `browser_result` — `{ status, message }` from browser agent
- `ide_result` — result from IDE agent
- `audio_delta` — audio chunks from x.ai realtime API

## Important Notes

1. **CORS**: Backend allows all origins for development
2. **Audio Format**: Frontend converts microphone input to PCM16 (16kHz mono)
3. **Grok API compatibility**: Must use Chat Completions mode (`useResponses: false`), not the OpenAI Responses API
4. **Tracing**: Disabled via env var — the OpenAI Agents SDK tracing hits `platform.openai.com` which rejects Grok API keys

## Dependencies

**Frontend**: React 19, Vite, Socket.IO-client, Axios
**Backend**: Express, Socket.IO, ws, OpenAI Agents SDK (`@openai/agents`), OpenAI client (`openai`), Playwright, MCP SDK, dotenv, zod
