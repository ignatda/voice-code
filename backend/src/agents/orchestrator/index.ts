import { Agent, handoff } from '@openai/agents';
import type { AppContext } from '../context.js';
import { getAgentModel } from '../../core/providers.js';

// Orchestrator = fast routing, no heavy reasoning needed
const MODELS: Record<string, string> = {
  xai:    'grok-4-1-fast-non-reasoning',
  gemini: 'gemini-3-flash-preview',
  groq:   'openai/gpt-oss-20b',
};
import { ensureProvider } from '../provider.js';
import { buildOrchestratorInstructions, type InstructionParts } from './instructions.js';

// ── Orchestrator factory ────────────────────────────────────────────────────
export interface OrchestratorOptions {
  browserAgent: Agent<AppContext>;
  ideAgent: Agent<AppContext>;
  plannerAgent: Agent<AppContext>;
  extraHandoffs?: any[];
  readOnly?: boolean;
  plannerMode?: boolean;
  pendingPlan?: string;
}

export async function createOrchestrator(opts: OrchestratorOptions): Promise<Agent<AppContext>> {
  ensureProvider();

  const readOnlyClause = opts.readOnly
    ? '\nREAD-ONLY MODE is active. Agents can only read/view/navigate. If the user asks for modifications, still hand off — the agent will inform them about read-only restrictions.'
    : '';

  const plannerModeClause = opts.plannerMode
    ? `\nPLANNER MODE IS ACTIVE. A planning session is in progress.
You MUST hand off to one of these ONLY:
1. **Planner Agent** — if the user continues discussing, refining, or asking about the plan (this is the default)
2. **IDE Agent** — ONLY if the user explicitly asks to implement/execute/build the plan
3. If the user says to exit/stop/cancel planning — respond with "PLANNER_EXIT" and do NOT hand off.
Do NOT hand off to Browser Agent while in planner mode.`
    : '';

  const pendingPlanClause = opts.pendingPlan
    ? `\nThere is a pending implementation plan:\n${opts.pendingPlan}\nIf the user says "implement it", "do it", "let's go", "execute", "go ahead" — hand off to IDE Agent. If the user wants to refine the plan, hand off to Planner Agent.`
    : '';

  // Auto-discover extension routing rules
  let extraParts: Partial<InstructionParts> = {};
  try {
    const mod = await import('../extensions/routing.js');
    extraParts = mod.default ?? {};
  } catch { /* extensions not available — no-op */ }

  const agentModel = getAgentModel(MODELS);

  const instructions = buildOrchestratorInstructions({
    readOnlyClause,
    plannerModeClause,
    pendingPlanClause,
    agentModel,
    ...extraParts,
  });

  return new Agent<AppContext>({
    name: 'Orchestrator',
    instructions,
    // tools: [],
    handoffs: [
      handoff(opts.browserAgent, { toolDescriptionOverride: 'Hand off to Browser Agent for web browsing, navigation, searching, clicking, scrolling, and page interaction.' }),
      handoff(opts.ideAgent, { toolDescriptionOverride: 'Hand off to IDE Agent for coding, file editing, IDE navigation, running commands, and project management.' }),
      handoff(opts.plannerAgent, { toolDescriptionOverride: 'Hand off to Planner Agent for designing implementation plans, architecture discussions, and feature planning.' }),
      ...(opts.extraHandoffs ?? []),
    ],
    model: agentModel,
  });
}

// ── Convenience: detect planner exit from orchestrator output ────────────────
export function isPlannerExit(output: string | undefined): boolean {
  return !!output && output.includes('PLANNER_EXIT');
}
