import OpenAI from 'openai';
import type { JetBrainsResult } from '../types';
import { getXAIConfig } from './config.js';
import logger from '../log.js';

const PLANNER_SYSTEM_PROMPT = `You are a Planning Agent for a voice-controlled IDE.

Your role is to analyze feature requests and produce a clear, step-by-step implementation plan in Markdown.

Rules:
- Output a concise Markdown plan with numbered steps
- Each step should be a specific, actionable code change (file to modify, what to add/change)
- Include file paths when known
- Do NOT write actual code — only describe what needs to be done
- Keep plans minimal — fewest steps possible
- If the request is vague or no specific feature is described, ask the user what they want to build. Start with a brief greeting like "Ready to plan! What feature would you like to build?" and optionally suggest clarifying questions.
- Use English regardless of input language
`;

export class PlannerAgent {
  private client: OpenAI;
  private model: string;
  private history: Map<string, Array<{ role: 'user' | 'assistant'; content: string }>> = new Map();

  constructor(apiKey: string) {
    const config = getXAIConfig();
    this.client = new OpenAI({ apiKey, baseURL: config.baseURL });
    this.model = config.model;
  }

  clearHistory(sid: string): void {
    this.history.delete(sid);
  }

  async process(prompt: string, sid: string, signal?: AbortSignal): Promise<JetBrainsResult> {
    logger.info(`[planner_agent] Received prompt: ${prompt}`);

    const sessionHistory = this.history.get(sid) || [];

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          ...sessionHistory,
          { role: 'user', content: prompt },
        ],
        temperature: 0.0,
      }, { signal });

      const content = response.choices[0]?.message?.content || 'No plan generated.';

      sessionHistory.push({ role: 'user', content: prompt });
      sessionHistory.push({ role: 'assistant', content });
      if (sessionHistory.length > 40) sessionHistory.splice(0, sessionHistory.length - 40);
      this.history.set(sid, sessionHistory);

      logger.info(`[planner_agent] Plan generated, length=${content.length}`);

      return {
        agent: 'planner' as any,
        status: 'success',
        message: content,
        received_prompt: prompt,
      };
    } catch (error) {
      if (signal?.aborted) {
        return { agent: 'planner' as any, status: 'error', message: 'Interrupted by user', received_prompt: prompt };
      }
      logger.error(`[planner_agent] Error: ${error}`);
      return { agent: 'planner' as any, status: 'error', message: String(error), received_prompt: prompt };
    }
  }
}
