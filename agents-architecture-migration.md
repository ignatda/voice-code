# Agents Architecture Migration

Migration plan to restructure the backend around the OpenAI Agents SDK primitives.

## Goals

1. Every feature is a self-contained agent package (own directory, own files, own scripts)
2. No monolith files — `index.ts` becomes a thin bootstrap
3. Closely aligned with OpenAI Agents SDK entities: `Agent`, `Handoff`, `FunctionTool`, `MCPServerStdio`, `Session`, `RunContext`, `InputGuardrail`
4. Shared infrastructure lives in `core/` (not `tools/` — avoids collision with SDK `Tool` terminology)

## SDK Entity Mapping

| SDK Primitive | Our Usage |
|---|---|
| `Agent` | Every agent is an SDK `Agent` instance with `name`, `instructions`, `tools`, `mcpServers`, `handoffs` |
| `handoff()` | Orchestrator hands off to browser/IDE/planner — replaces manual JSON-parse routing |
| `FunctionTool` / `tool()` | CLI bridges (opencode, kiro) + translation tool are `FunctionTool` instances |
| `MCPServerStdio` | JetBrains MCP, VS Code MCP, Playwright MCP — one per agent that needs it |
| `Session` | `AgentSession` implements SDK `Session` interface, backed by JSON files |
| `RunContext` | `AppContext` (config, logger, readOnly, sessionId) passed via `run()` context option |
| `InputGuardrail` | `readOnlyGuardrail` — blocks write operations on IDE and browser agents |
| `run()` | Single entry point in `router.ts` — SDK manages turn loop, history, handoffs |

## Target Structure

```
backend/src/
├── index.ts                    # Bootstrap: loadEnv → imports → listen
├── server.ts                   # Express + Socket.IO setup
├── router.ts                   # Socket.IO event handlers → run(orchestrator, input, { session })
│
├── agents/
│   ├── context.ts              # AppContext type for SDK RunContext
│   ├── guardrails.ts           # readOnlyGuardrail (SDK InputGuardrail)
│   ├── provider.ts             # OpenAIProvider setup (Grok/x.ai config)
│   ├── index.ts                # buildAgentGraph() — wires handoffs, re-exports
│   │
│   ├── orchestrator/
│   │   └── index.ts            # SDK Agent + handoffs + translate_to_english FunctionTool
│   │
│   ├── browser/
│   │   └── index.ts            # SDK Agent + Playwright MCPServerStdio
│   │
│   ├── planner/
│   │   └── index.ts            # SDK Agent, no tools
│   │
│   ├── voice/
│   │   └── index.ts            # Native (WebSocket to x.ai Realtime API, not an SDK Agent)
│   │
│   └── ide/
│       ├── index.ts            # Factory: builds SDK Agent with right MCP + right CLI tools
│       ├── mcp/
│       │   ├── jetbrains.ts    # MCPServerStdio config for JetBrains
│       │   └── vscode.ts       # MCPServerStdio config for VS Code
│       └── tools/
│           ├── cli.ts          # getCliFunctionTool() — returns opencode or kiro FunctionTool
│           ├── opencode.ts     # FunctionTool: spawns opencode CLI
│           ├── opencode-wrapper.sh
│           ├── kiro.ts         # FunctionTool: spawns kiro-cli
│           ├── kiro-wrapper.sh
│           └── stop.sh         # Kill script for CLI processes
│
├── core/
│   ├── index.ts                # Re-exports
│   ├── logger.ts               # Pino logger
│   ├── config.ts               # Env loading, validation, getXAIConfig, getAgentsMd
│   ├── session.ts              # SessionStore (UI) + AgentSession (SDK Session, JSON-backed)
│   └── interrupt.ts            # AbortController registry, stop detection
│
├── routes/
│   └── settings.ts             # REST endpoint (uses core/config)
│
└── types/
    └── index.ts                # Voice client types only (XAIWebSocketMessage, SessionConfig)
```

## Dependency Flow

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

## File Migration Map

| Current File | Target | Notes |
|---|---|---|
| `index.ts` (449 lines) | `index.ts` (~20 lines) + `server.ts` (~30 lines) + `router.ts` (~120 lines) | Session store code → `core/session.ts` |
| `log.ts` | `core/logger.ts` | Rename only |
| `config/env.ts` | `core/config.ts` | Merge with `agents/config.ts` |
| `agents/config.ts` | `core/config.ts` | `getXAIConfig()` + `getAgentsMd()` merge in |
| `interrupt.ts` | `core/interrupt.ts` | Move only |
| `agents/orchestrator.ts` | `agents/orchestrator/index.ts` | Rewrite: SDK Agent + handoffs + translate FunctionTool, drop manual OpenAI client |
| `agents/browser.ts` | `agents/browser/index.ts` | Simplify: pure SDK Agent factory, no wrapper class |
| `agents/planner.ts` | `agents/planner/index.ts` | Rewrite: pure SDK Agent factory, drop manual OpenAI client + history |
| `agents/ide.ts` | `agents/ide/index.ts` + `mcp/` + `tools/` | Split: MCP configs → own files, CLI logic → FunctionTool files |
| `xai-realtime.ts` | `agents/voice/index.ts` | Move, stays native (WebSocket doesn't fit SDK Agent model) |
| `scripts/kiro-wrapper.sh` | `agents/ide/tools/kiro-wrapper.sh` | Move into IDE agent package |
| `scripts/opencode-wrapper.sh` | `agents/ide/tools/opencode-wrapper.sh` | Move into IDE agent package |
| `scripts/stop.sh` | `agents/ide/tools/stop.sh` | Move into IDE agent package |
| `types/index.ts` | `types/index.ts` | Slim down — `BrowserResult`, `IDEResult`, `OrchestratorResult` removed (replaced by SDK `RunResult`) |
| `routes/settings.ts` | `routes/settings.ts` | Update imports to `core/config` |
| `agents/index.ts` | `agents/index.ts` | Rewrite: `buildAgentGraph()` wires handoffs, exports SDK factories |

## Deleted After Migration

- `config/` directory (merged into `core/config.ts`)
- `scripts/` directory (scripts moved into their agent packages)
- `agents/config.ts` (merged into `core/config.ts`)
- `xai-realtime.ts` (becomes `agents/voice/index.ts`)

## Key Design Decisions

### 1. Orchestrator Uses SDK Handoffs

Before (manual routing):
```typescript
// orchestrator returns JSON: { prompts: [{ agent: "jetbrains", prompt: "..." }] }
// index.ts parses and dispatches manually with if/else
```

After (SDK handoffs):
```typescript
const orchestrator = new Agent({
  name: 'Orchestrator',
  instructions: '...routing instructions...',
  handoffs: [
    handoff(browserAgent),
    handoff(ideAgent),
    handoff(plannerAgent),
  ],
});

// router.ts — one line
const result = await run(orchestrator, transcription, { session, signal });
// SDK handles agent transfer automatically
```

### 2. CLI Bridges Are FunctionTools, Not Agents

CLI bridges don't reason or decide — they execute a command. They're tools the IDE agent uses.

```typescript
// agents/ide/tools/opencode.ts
export const opencodeTool = tool({
  name: 'run_opencode',
  description: 'Execute a coding task via opencode CLI',
  parameters: z.object({ prompt: z.string() }),
  execute: async ({ prompt }) => {
    // spawn wrapper script, return stdout
  },
});

// agents/ide/index.ts
export const ideAgent = new Agent({
  name: 'IDE Agent',
  mcpServers: [jetbrainsMcp],       // or vscodeMcp
  tools: [opencodeTool],            // or kiroTool
});
```

### 3. AgentSession Implements SDK Session Interface

Replaces all manual history maps (orchestrator, IDE, planner).

```typescript
// core/session.ts
import type { Session, AgentInputItem } from '@openai/agents';

export class AgentSession implements Session {
  constructor(private id: string) {}

  async getSessionId() { return this.id; }
  async getItems(limit?: number): Promise<AgentInputItem[]> { /* read JSON file */ }
  async addItems(items: AgentInputItem[]) { /* append to JSON file */ }
  async popItem() { /* remove last item */ }
  async clearSession() { /* delete file */ }
}
```

Usage in router:
```typescript
const session = new AgentSession(sessionId);
const result = await run(orchestrator, transcription, { session, signal, context });
```

### 4. Read-Only Mode Is an InputGuardrail

Before: string manipulation in instructions (`"READ-ONLY MODE: ..."`)

After:
```typescript
import type { InputGuardrail } from '@openai/agents';

export const readOnlyGuardrail: InputGuardrail = {
  name: 'read_only_mode',
  execute: async ({ input }) => {
    // Check if input requests write operations, trip if so
  },
};

// Applied on agent construction when readOnly=true
const ide = await createIDEAgent(readOnly);  // adds inputGuardrails: [readOnlyGuardrail]
const browser = await createBrowserAgent(readOnly);
```

### 5. Voice Agent Stays Native

The x.ai Realtime API is a persistent WebSocket streaming PCM16 audio. This doesn't fit the SDK's prompt-in/response-out `Agent` model. It stays as native TypeScript but lives in `agents/voice/` for consistency.

### 6. AppContext via RunContext

```typescript
// agents/context.ts
export interface AppContext {
  config: { apiKey: string; baseURL: string; model: string };
  logger: Logger;
  readOnly: boolean;
  sessionId: string;
}

// router.ts
const context: AppContext = { config: getXAIConfig(), logger, readOnly: isReadOnly, sessionId };
const result = await run(orchestrator, input, { context, session, signal });
```

## Migration Steps

Each step is independently committable and testable.

### Phase 1: Extract core/ (no behavior change)

1. ~~`core/logger.ts` — move `log.ts`, update all imports~~ ✅
2. ~~`core/config.ts` — merge `config/env.ts` + `agents/config.ts`, update all imports~~ ✅
3. ~~`core/interrupt.ts` — move `interrupt.ts`, update all imports~~ ✅
4. ~~`core/session.ts` — extract session CRUD from `index.ts` (keep current format, don't implement SDK Session yet)~~ ✅

### Phase 2: Split index.ts (no behavior change)

5. ~~`server.ts` — extract Express + Socket.IO setup~~ ✅
6. ~~`router.ts` — extract all Socket.IO event handlers~~ ✅
7. ~~`index.ts` — shrink to bootstrap (~20 lines)~~ ✅

### Phase 3: Restructure agents into packages (no behavior change)

8. ~~`agents/browser/index.ts` — move `browser.ts` into directory~~ ✅
9. ~~`agents/planner/index.ts` — move `planner.ts` into directory~~ ✅
10. ~~`agents/orchestrator/index.ts` — move `orchestrator.ts` into directory~~ ✅
11. ~~`agents/voice/index.ts` — move `xai-realtime.ts` into agent package~~ ✅
12. ~~`agents/ide/` — split `ide.ts` into `index.ts` + `mcp/jetbrains.ts` + `mcp/vscode.ts` + `tools/opencode.ts` + `tools/kiro.ts`, move shell scripts into `tools/`~~ ✅

### Phase 4: Adopt SDK primitives (behavior-preserving rewrites)

13. ~~`agents/provider.ts` — extract OpenAIProvider setup~~ ✅
14. ~~`agents/ide/tools/opencode.ts` + `kiro.ts` — rewrite CLI bridges as `FunctionTool` using `tool()` from SDK~~ ✅
15. ~~`agents/ide/index.ts` — rewrite as SDK Agent factory with MCP + FunctionTools~~ ✅
16. ~~`agents/browser/index.ts` — simplify to SDK Agent (drop wrapper class)~~ ✅
17. ~~`agents/planner/index.ts` — rewrite as SDK Agent (drop manual OpenAI client)~~ ✅
18. ~~`core/session.ts` — implement SDK `Session` interface (`AgentSession`)~~ ✅
19. ~~`agents/orchestrator/index.ts` — rewrite as SDK Agent with `handoff()` to browser, ide, planner + translate FunctionTool~~ ✅
20. ~~`agents/context.ts` — define `AppContext` type for RunContext~~ ✅
21. ~~`router.ts` — switch to `run(orchestrator, input, { session, signal, context })`~~ ✅
22. ~~Read-only mode — implement as `InputGuardrail` on IDE and browser agents~~ ✅

### Phase 5: Cleanup

23. ~~Delete `config/` directory, `scripts/` directory, `agents/config.ts`~~ ✅ (already removed in earlier steps)
24. ~~Slim down `types/index.ts` — removed `OrchestratorResult`, `BrowserResult`, `IDEResult` (replaced by SDK `RunResult`)~~ ✅
25. ~~Update `AGENTS.md` to reflect new architecture~~ ✅
26. ~~Update `agents/index.ts` — `buildAgentGraph()` wires handoffs, clean re-exports~~ ✅
