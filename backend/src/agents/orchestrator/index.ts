import { Agent, handoff, tool } from '@openai/agents';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { getXAIConfig } from '../../core';
import { ensureProvider } from '../provider.js';
import logger from '../../core/logger.js';

// ── Translation tool ────────────────────────────────────────────────────────
const translateTool = tool({
  name: 'translate_to_english',
  description: 'Translate text from any language to English. If already English, return as-is.',
  parameters: z.object({ text: z.string() }),
  execute: async ({ text }) => {
    const config = getXAIConfig();
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    try {
      const r = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: 'You are a translator. Translate any language to English. Just output the translated text, nothing else.' },
          { role: 'user', content: `Translate to English. If already English, return as-is:\n\n${text}` },
        ],
        temperature: 0.0,
      });
      return r.choices[0]?.message?.content?.trim() || text;
    } catch (e) {
      logger.error(`[orchestrator] Translation error: ${e}`);
      return text;
    }
  },
});

// ── Orchestrator factory ────────────────────────────────────────────────────
export interface OrchestratorOptions {
  browserAgent: Agent<AppContext>;
  ideAgent: Agent<AppContext>;
  plannerAgent: Agent<AppContext>;
  readOnly?: boolean;
  plannerMode?: boolean;
  pendingPlan?: string;
}

export function createOrchestrator(opts: OrchestratorOptions): Agent<AppContext> {
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

  return new Agent<AppContext>({
    name: 'Orchestrator',
    instructions: `You are an Orchestrator Agent for a voice-controlled IDE.

Your role: analyze transcribed user speech, translate it to English if needed (use the translate_to_english tool), then hand off to the right specialized agent.

## Routing rules:
- Planning/design requests ("plan", "design", "think about", "how should we", "let's discuss", "new feature", "open the planner") → hand off to **Planner Agent** ONLY
- Implementation triggers ("implement it", "do it", "let's go", "execute", "build it") → hand off to **IDE Agent**
- Direct IDE actions (open, search, navigate, run, edit code) → hand off to **IDE Agent**
- Web/browser actions (browse, search web, open URL, scroll, click, close tab, close browser, open browser, go back, go forward) → hand off to **Browser Agent**
- Refinement of an existing plan ("also add logging", "skip the tests") → hand off to **Planner Agent**
- Greetings with no actionable request → respond directly, no handoff

## Process:
1. First, use translate_to_english to translate the user's speech to English
2. Then hand off to the appropriate agent with a clear, actionable English prompt

IMPORTANT: When the user asks to plan or design something, hand off ONLY to Planner Agent — even if they mention code/files/IDE. Planning always goes to planner first.
${readOnlyClause}${plannerModeClause}${pendingPlanClause}`,
    tools: [translateTool],
    handoffs: [
      handoff(opts.browserAgent, { toolDescriptionOverride: 'Hand off to Browser Agent for web browsing, navigation, searching, clicking, scrolling, and page interaction.' }),
      handoff(opts.ideAgent, { toolDescriptionOverride: 'Hand off to IDE Agent for coding, file editing, IDE navigation, running commands, and project management.' }),
      handoff(opts.plannerAgent, { toolDescriptionOverride: 'Hand off to Planner Agent for designing implementation plans, architecture discussions, and feature planning.' }),
    ],
    model: getXAIConfig().model,
  });
}

// ── Convenience: detect planner exit from orchestrator output ────────────────
export function isPlannerExit(output: string | undefined): boolean {
  return !!output && output.includes('PLANNER_EXIT');
}
