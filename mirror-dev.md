# Mirror Dev — Extensions & Background Tasks

## Goal

Maintain a private fork with extension agents, background tasks, and scheduled runs that stays in sync with the community `voice-code` repo without merge conflicts. All features use the same auto-discovery pattern: community code has hooks, extensions branch only adds files.

### Design Principles

- **Declarative code, agent decisions** — code defines tools and wires agents; agents decide routing, parameters, and when to act. No `if/else` business logic in TS.
- **Tools are capabilities** — they describe what they can do; the agent's prompt decides when to use them.
- **SDK alignment** — all orchestration flows through OpenAI Agents SDK `run()`. Background tasks and scheduled runs use `FunctionTool` with native TS execution inside.
- **Auto-discovery via dynamic `import()`** — community code tries to import extension modules; if absent, silently skips. Extensions branch only adds files, never modifies shared code.
- **Everything off by default** — extensions, scheduled tasks, and background tasks are disabled unless explicitly enabled via env vars or Settings UI.

---

## Phase 1: Git Setup (Two-Remote + Branch)

1. Create empty private repo (e.g. `ignatda/voice-code-private`) on GitHub.
2. Rename current remote: `git remote rename origin upstream`
3. Add private remote: `git remote add origin <private-repo-url>`
4. Push: `git push -u origin main`
5. Create extensions branch: `git checkout -b extensions && git push -u origin extensions`

Remotes:
- `upstream` → community (public)
- `origin` → private

Branches:
- `main` — mirrors upstream, pushed to both remotes
- `extensions` — rebased on `main`, pushed to `origin` only

---

## Phase 2: Extensions Directory Structure

All extension code lives in `backend/src/agents/extensions/`:

```
backend/src/agents/extensions/
├── index.ts          # registerExtensions() — wires extension agents into the graph
├── routing.ts        # default export: { extraRouting, extraInstructions }
├── schedules.ts      # Extension schedule definitions (Phase 7)
├── example/
│   └── index.ts      # Example extension agent (disabled by default)
├── agent-x/
│   └── index.ts
└── agent-y/
    └── index.ts
```

Community repo ships the `extensions/` directory with only `index.ts` (registration hook) and `example/` (disabled template). Private extensions live alongside on the extensions branch.

---

## Phase 3: Composable Orchestrator Prompt

### 3a. Extract instruction builder (community change)

Create `backend/src/agents/orchestrator/instructions.ts`:

- Export `InstructionParts` interface with optional fields: `readOnlyClause`, `plannerModeClause`, `pendingPlanClause`, `extraRouting`, `extraInstructions`
- Export `buildOrchestratorInstructions(parts)` that assembles the full prompt string

Update `orchestrator/index.ts` to use `buildOrchestratorInstructions()`.

### 3b. Auto-discovery hook (community change, add once)

In the orchestrator factory, dynamically import extension routing:

```typescript
let extraParts: Partial<InstructionParts> = {};
try {
  const mod = await import('../extensions/routing.js');
  extraParts = mod.default ?? {};
} catch { /* extensions not available — no-op */ }
```

Spread `extraParts` into `buildOrchestratorInstructions()`.

### 3c. Extensions routing (extensions branch only)

Create `backend/src/agents/extensions/routing.ts`:

- Default export with `extraRouting` (routing rules for extension agents) and `extraInstructions` (additional behavioral rules)
- Community `example/` has no routing — it's hidden from the orchestrator by default

---

## Phase 4: Agent Graph Auto-Discovery (community change, add once)

In `backend/src/agents/index.ts` (`buildAgentGraph()`), add dynamic import hook:

```typescript
try {
  const { registerExtensions } = await import('./extensions/index.js');
  registerExtensions(agentGraph);
} catch { /* extensions not available */ }
```

On the extensions branch, `extensions/index.ts` exports `registerExtensions()` which adds extension agents and their handoffs to the graph.

---

## Phase 5: Enable/Disable via Settings

Extensions and scheduled tasks are toggled via env vars (comma-separated list or `none`).

### 5a. Backend: add to settings

- Add `EXTENSIONS` and `SCHEDULED_TASKS` to `getSettingsSnapshot()` in `core/config.ts`
- Add both to the `allowed` set in `routes/settings.ts`
- Add both to `.env.example` with default `none`

### 5b. Frontend: add to Settings UI

- Add inputs for `EXTENSIONS` and `SCHEDULED_TASKS` in `Settings.jsx`
- Values: `none` (default), or comma-separated names

### 5c. Extensions read the setting

In `extensions/index.ts`, `registerExtensions()` reads `process.env.EXTENSIONS` and only registers the listed agents:

```typescript
export function registerExtensions(graph: AgentGraph) {
  const enabled = (process.env.EXTENSIONS || 'none').split(',').map(s => s.trim());
  if (enabled.includes('none') || enabled.length === 0) return;

  if (enabled.includes('example')) {
    // register example agent + handoff
  }
  // ... other extensions
}
```

### 5d. Example extension agent

`extensions/example/index.ts` — a minimal agent that echoes back the input. Hidden from the orchestrator by default (no routing rules). Only wired in when `EXTENSIONS=example` is set. Serves as a template for creating new extensions.

---

## Phase 6: Background Tasks

Background tasks are SDK `FunctionTool` declarations with native TS execution inside. The agent decides when to dispatch them; the code is purely declarative.

### 6a. Task registry and FunctionTool (community change)

```
backend/src/agents/tasks/
├── index.ts          # FunctionTool: run_background_task
├── registry.ts       # taskRegistry Map<name, TaskFn> + auto-discovery hook
└── runners/
    └── example.ts    # Example task (disabled by default)
```

`registry.ts` — declarative task registry:

```typescript
export type TaskFn = (params: Record<string, string>) => Promise<string>;

const taskRegistry = new Map<string, TaskFn>();

// Community tasks
taskRegistry.set('example-echo', async ({ message }) => message);

// Auto-discover extension tasks
try {
  const mod = await import('../extensions/tasks.js');
  for (const [name, fn] of Object.entries(mod.default ?? {})) {
    taskRegistry.set(name, fn as TaskFn);
  }
} catch { /* no extension tasks */ }

export { taskRegistry };
```

`index.ts` — FunctionTool (agent decides when to call it):

```typescript
export const backgroundTaskTool = tool({
  name: 'run_background_task',
  description: 'Run a long-running task in the background. Returns immediately with a task ID.',
  parameters: z.object({
    task: z.string().describe('Task name'),
    params: z.record(z.string()).describe('Task parameters'),
  }),
  execute: async ({ task, params }) => {
    const fn = taskRegistry.get(task);
    if (!fn) return `Unknown task: ${task}`;
    const taskId = crypto.randomUUID();
    // Fire-and-forget — agent gets immediate response
    fn(params)
      .then(output => socket.emit('task_status', { taskId, task, status: 'completed', output }))
      .catch(err => socket.emit('task_status', { taskId, task, status: 'error', message: err.message }));
    return `Task "${task}" started (id: ${taskId})`;
  },
});
```

### 6b. Extension tasks (extensions branch only)

`backend/src/agents/extensions/tasks.ts`:

```typescript
import type { TaskFn } from '../tasks/registry.js';

const extensionTasks: Record<string, TaskFn> = {
  'deploy-staging': async ({ branch }) => {
    // native TS execution — no LLM calls
    await exec(`git push staging ${branch}`);
    return 'Deployed';
  },
};

export default extensionTasks;
```

Merged into the task registry at startup via auto-discovery.

---

## Phase 7: Scheduled Tasks

Scheduled tasks are declarative cron definitions that trigger agent `run()` calls periodically. Same auto-discovery pattern as extensions.

### 7a. Community: scheduler core + example schedule

```
backend/src/agents/tasks/
├── scheduler.ts        # Cron runner — reads schedules, calls run()
└── schedules.ts        # Community schedule definitions (array)
```

`schedules.ts` — declarative schedule config:

```typescript
export interface ScheduleEntry {
  name: string;
  cron: string;
  agent: string;       // agent name to run()
  prompt: string;      // what to ask the agent — agent decides the rest
  enabled?: boolean;
}

export const schedules: ScheduleEntry[] = [
  // Example: disabled by default, enable via SCHEDULED_TASKS=example-health-check
  { name: 'example-health-check', cron: '0 */6 * * *', agent: 'browser', prompt: 'Check if http://localhost:5173 is responding and report status', enabled: false },
];
```

`scheduler.ts` — reads schedules + extension schedules, starts cron jobs:

```typescript
import cron from 'node-cron';

export function startScheduler(agents: Record<string, Agent>, allSchedules: ScheduleEntry[]) {
  const enabled = (process.env.SCHEDULED_TASKS || 'none').split(',').map(s => s.trim());
  if (enabled.includes('none')) return;

  for (const schedule of allSchedules) {
    if (!enabled.includes(schedule.name)) continue;
    cron.schedule(schedule.cron, () => {
      run(agents[schedule.agent], schedule.prompt, { context });
    });
  }
}
```

### 7b. Auto-discovery hook for extension schedules (community, add once)

In `scheduler.ts`, dynamically import extension schedules:

```typescript
let extensionSchedules: ScheduleEntry[] = [];
try {
  const mod = await import('../extensions/schedules.js');
  extensionSchedules = mod.default ?? [];
} catch { /* no extension schedules */ }

startScheduler(agents, [...schedules, ...extensionSchedules]);
```

### 7c. Extension schedules (extensions branch only)

`backend/src/agents/extensions/schedules.ts`:

```typescript
import type { ScheduleEntry } from '../tasks/schedules.js';

const extensionSchedules: ScheduleEntry[] = [
  { name: 'nightly-deploy-check', cron: '0 2 * * *', agent: 'deploy-agent', prompt: 'Verify all staging deployments are healthy' },
];

export default extensionSchedules;
```

Extension schedules are merged with community schedules at startup. They only run when listed in `SCHEDULED_TASKS`.

---

## Phase 8: Sync Workflow

### Pull community updates
```bash
git checkout main
git pull upstream main
git push origin main
git checkout extensions
git rebase main
git push origin extensions --force-with-lease
```

### Push community contributions
```bash
git checkout main
# ... make changes ...
git push upstream main
git push origin main
```

---

## Conflict Minimization Rules

1. Extension code lives **only** in `agents/extensions/` — never modify community agent files on the extensions branch.
2. Community repo has auto-discovery hooks (dynamic `import()` with `try/catch`) — added once, never changed.
3. Orchestrator prompt is composable via `InstructionParts` — extensions branch only provides extra fields, never edits the base prompt.
4. Task registry and scheduler merge extension entries at startup — extensions branch only adds files.
5. Everything is disabled by default (`EXTENSIONS=none`, `SCHEDULED_TASKS=none`) — safe to merge community code without side effects.
6. Rebase (not merge) `extensions` onto `main` to keep a linear history.

---

## Auto-Discovery Summary

All extension points use the same pattern — community code tries dynamic `import()`, extensions branch provides the module:

| Hook Location | Imports | Provides |
|---|---|---|
| `orchestrator/index.ts` | `extensions/routing.js` | Extra routing rules for orchestrator prompt |
| `agents/index.ts` | `extensions/index.js` | `registerExtensions()` — agents + handoffs |
| `tasks/registry.ts` | `extensions/tasks.js` | Extra background task functions |
| `tasks/scheduler.ts` | `extensions/schedules.js` | Extra scheduled task definitions |

All hooks are `try/catch` with silent fallback — community repo works without any extensions present.

---

## Status

- [ ] Phase 1: Git setup
- [x] Phase 2: Extensions directory structure
- [x] Phase 3a: Extract `buildOrchestratorInstructions()`
- [x] Phase 3b: Auto-discovery hook in orchestrator
- [x] Phase 3c: Extensions routing file
- [x] Phase 4: Agent graph auto-discovery
- [x] Phase 5a: Backend settings for `EXTENSIONS` and `SCHEDULED_TASKS`
- [x] Phase 5b: Frontend settings UI
- [x] Phase 5c: Extensions read setting
- [x] Phase 5d: Example extension agent
- [x] Phase 6a: Task registry + FunctionTool
- [x] Phase 6b: Extension tasks file
- [x] Phase 7a: Scheduler core + example schedule
- [x] Phase 7b: Auto-discovery hook for extension schedules
- [x] Phase 7c: Extension schedules file
- [ ] Phase 8: First sync cycle test
