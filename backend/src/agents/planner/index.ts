import { Agent } from '@openai/agents';
import type { AppContext } from '../context.js';
import { getAgentsMd } from '../../core/config.js';
import { getAgentModel } from '../../core/providers.js';

// Planner = deep reasoning, can be slow but must be sharp
const MODELS: Record<string, string> = {
  xai:    'grok-4.20-0309-reasoning',
  gemini: 'gemini-3.1-pro-preview',
  groq:   'openai/gpt-oss-120b',
};
import { ensureProvider } from '../provider.js';

export function createPlannerAgent(): Agent<AppContext> {
  ensureProvider();
  return new Agent<AppContext>({
    name: 'Planner Agent',
    handoffDescription: 'Designs implementation plans for complex features, architecture discussions, and feature planning.',
    instructions: `You are a Planning Agent for a voice-controlled IDE.

Your role is to analyze feature requests and produce a clear, step-by-step implementation plan in Markdown.

Rules:
- Output a concise Markdown plan with numbered steps
- Each step should be a specific, actionable code change (file to modify, what to add/change)
- Include file paths when known
- Do NOT write actual code — only describe what needs to be done
- Keep plans minimal — fewest steps possible
- If the request is vague or no specific feature is described, ask the user what they want to build
- Use English regardless of input language

${getAgentsMd()}
`,
    model: getAgentModel(MODELS),
  });
}
