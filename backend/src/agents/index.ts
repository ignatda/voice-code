import type { Agent } from '@openai/agents';
import type { AppContext } from './context.js';
import { createBrowserAgent } from './browser/index.js';
import { createIDEAgent, killTerminalProcess } from './ide/index.js';
import { createPlannerAgent } from './planner/index.js';
import { createOrchestrator, isPlannerExit } from './orchestrator/index.js';

export { ensureProvider } from './provider.js';
export { readOnlyGuardrail, safetyAndOfftopicGuardrail } from './guardrails.js';
export { isPlannerExit } from './orchestrator/index.js';
export { killTerminalProcess } from './ide/index.js';
export type { AppContext } from './context.js';

export interface AgentGraph {
  orchestrator: Agent<AppContext>;
  browser: Agent<AppContext>;
  ide: Agent<AppContext>;
  planner: Agent<AppContext>;
}

/** Build the full agent graph with handoffs wired up. */
export async function buildAgentGraph(opts?: {
  readOnly?: boolean;
  plannerMode?: boolean;
  pendingPlan?: string;
}): Promise<AgentGraph> {
  const readOnly = opts?.readOnly ?? false;
  const browser = await createBrowserAgent(readOnly);
  const ide = await createIDEAgent(readOnly);
  const planner = createPlannerAgent();

  // Auto-discover extension agents
  let extraHandoffs: any[] = [];
  try {
    const { registerExtensions } = await import('./extensions/index.js');
    extraHandoffs = await registerExtensions({ browser, ide, planner });
  } catch { /* extensions not available */ }

  const orchestrator = await createOrchestrator({
    browserAgent: browser,
    ideAgent: ide,
    plannerAgent: planner,
    extraHandoffs,
    readOnly: opts?.readOnly,
    plannerMode: opts?.plannerMode,
    pendingPlan: opts?.pendingPlan,
  });

  return { orchestrator, browser, ide, planner };
}
