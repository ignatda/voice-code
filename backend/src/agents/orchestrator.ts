import OpenAI from 'openai';
import type { OrchestratorResult } from '../types';
import logger from '../log.js';

const ORCHESTRATOR_SYSTEM_PROMPT = `You are an Orchestrator Agent for a voice-controlled IDE.

Your role is to analyze transcribed user speech and determine which specialized agents should respond.

Available agents:
1. **browser** - Controls web browser (open pages, search, navigate, read content, watch videos, control video playback, scroll, click, close tabs, find elements on page)
2. **jetbrains** - Controls IDE (IntelliJ IDEA) - create files, edit code, run commands, manage projects
3. **planner** - Designs implementation plans for complex features before coding. Use for architecture, design, planning discussions.

Routing rules:
- Planning/design requests (e.g. "plan", "design", "think about", "how should we", "let's discuss", "what's the best way to", "new feature", "let's plan", "open the planner", "open planner", "start planning") → **planner** ONLY (do NOT also route to jetbrains)
- Implementation triggers (e.g. "implement it", "do it", "let's go", "execute", "make it", "build it", "go ahead") when a plan was previously discussed → **jetbrains** (the plan will be provided in a separate system message; if no plan exists yet, route to **planner** instead)
- Direct IDE actions (open, search, navigate, run, simple edits) → **jetbrains**
- Web/browser actions → **browser**
- Refinement of an existing plan (e.g. "also add logging", "skip the tests", "change step 2") → **planner**

IMPORTANT: When the user asks to plan or design something, route ONLY to planner — even if they mention frontend, backend, files, or code. Planning always goes to planner first, implementation comes later.

Output format (JSON):
{
  "original_text": "<the transcribed text>",
  "prompts": [
    {
      "agent": "browser" | "jetbrains" | "planner",
      "prompt": "<specific action to perform>"
    }
  ]
}

Rules:
- If the user mentions browsing, searching, opening a website, reading web content, watching videos, video playback, scrolling, clicking, closing tabs, or any web/navigation action → include browser agent
- If the user asks to plan, design, discuss, or think about a feature or architecture → include ONLY planner agent (NOT jetbrains, even if they mention code/files/IDE)
- If the user mentions coding, files, IDE, running code, or codebase actions AND is NOT planning/designing → include jetbrains agent
- If the speech is just a greeting with no actionable request (e.g. "hello", "hi") → prompts array can be empty
- When in doubt between planner and jetbrains: if the user is describing what to build → **planner**; if the user is asking to do a specific action right now → **jetbrains**. Prefer generating a prompt over returning empty.
- Always preserve the original transcribed text exactly
- Make prompts specific and actionable
- Use English for prompts regardless of the input language
- Output only valid JSON, no additional text
- NEVER return empty prompts for valid commands - always include at least one agent if the user is asking to do something
- Common commands to recognize:
  - "open the planner" / "open planner" / "start planning" → planner agent (NOT browser)
  - "scroll" / "scroll down" / "scroll up" → browser agent
  - "open" / "go to" / "navigate to" → browser agent
  - "search" / "find" → browser agent
  - "click" / "press" → browser agent
  - "close" / "close the browser" → browser agent
`;

export class OrchestratorAgent {
  private client: OpenAI;
  private model: string;
  private history: Map<string, Array<{ role: 'user' | 'assistant'; content: string }>> = new Map();

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
    });
    this.model = 'grok-4-1-fast-non-reasoning';
  }

  clearHistory(sid: string): void {
    this.history.delete(sid);
  }

  async process(transcription: string, readOnly = false, sid?: string, pendingPlan?: string, plannerMode = false): Promise<OrchestratorResult> {
    if (!transcription || transcription.trim().length < 3) {
      return {
        original_text: transcription,
        prompts: [],
      };
    }

    if (transcription.trim().endsWith('...')) {
      return {
        original_text: transcription,
        prompts: [],
      };
    }

    const stripped = transcription.trim();
    if (stripped && stripped[stripped.length - 1] === '-' && stripped.length < 10) {
      return {
        original_text: transcription,
        prompts: [],
      };
    }

    let translatedText = transcription;
    try {
      const translationResponse = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a translator. Translate any language to English. Just output the translated text, nothing else.',
          },
          {
            role: 'user',
            content: `Translate the following text to English. If it's already in English, return it as-is. Just output the translated text, nothing else:\n\n${transcription}`,
          },
        ],
        temperature: 0.0,
      });
      translatedText = translationResponse.choices[0]?.message?.content?.trim() || transcription;
    } catch (error) {
      logger.error(`[orchestrator] Translation error: ${error}`);
    }

    const sessionHistory = sid ? (this.history.get(sid) || []) : [];

    try {
      const userMsg = `Analyze this transcribed speech and output JSON with agent prompts: ${translatedText}`;
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
          ...(readOnly ? [{ role: 'system' as const, content: 'READ-ONLY MODE is active. Agents can only read/view/navigate. Do NOT generate prompts for writing, editing, creating, or deleting files or code. If the user asks for modifications, still route to the appropriate agent — the agent will inform them about read-only restrictions.' }] : []),
          ...(plannerMode ? [{ role: 'system' as const, content: `PLANNER MODE IS ACTIVE. A planning session is in progress.\n\nYou MUST route to one of these options ONLY:\n1. **planner** — if the user continues discussing, refining, or asking about the plan (this is the default)\n2. **jetbrains** — ONLY if the user explicitly asks to implement/execute/build the plan. Include the full plan in the prompt: "Implement the following plan:\\n${pendingPlan || '(no plan yet)'}"\n3. **empty prompts** — ONLY if the user says to exit/stop/cancel planning (e.g. "exit plan", "done planning", "cancel plan"). In this case also set "exit_planner": true in the JSON.\n\nDo NOT route to browser. Do NOT bypass the planner for unrelated requests — the user is in a planning session.\n\nOutput format when exiting planner:\n{"original_text": "...", "prompts": [], "exit_planner": true}` }] : []),
          ...(pendingPlan && !plannerMode ? [{ role: 'system' as const, content: `There is a pending implementation plan from the planner agent:\n\n${pendingPlan}\n\nIf the user says something like "implement it", "do it", "let's go", "execute", "go ahead" — route to jetbrains with the full plan as the prompt. If the user wants to refine the plan, route to planner.` }] : []),
          ...sessionHistory,
          { role: 'user', content: userMsg },
        ],
        temperature: 0.0,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from model');
      }

      // Extract JSON from response (model may wrap in Markdown fences or add extra text)
      const jsonMatch = content.match(/\{[\s\S]*}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      const result = JSON.parse(jsonMatch[0]);

      if (sid) {
        sessionHistory.push({ role: 'user', content: userMsg });
        sessionHistory.push({ role: 'assistant', content: content });
        // Keep last 20 turns to avoid token overflow
        if (sessionHistory.length > 40) sessionHistory.splice(0, sessionHistory.length - 40);
        this.history.set(sid, sessionHistory);
      }

      return {
        original_text: transcription,
        prompts: result.prompts || [],
        ...(result.exit_planner ? { exit_planner: true } : {}),
      };
    } catch (error) {
      logger.error(`[orchestrator] Error: ${error}`);
      return {
        original_text: transcription,
        prompts: [],
      };
    }
  }
}
