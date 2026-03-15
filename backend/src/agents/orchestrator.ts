import OpenAI from 'openai';
import type { OrchestratorResult } from '../types';

const ORCHESTRATOR_SYSTEM_PROMPT = `You are an Orchestrator Agent for a voice-controlled IDE.

Your role is to analyze transcribed user speech and determine which specialized agents should respond.

Available agents:
1. **browser** - Controls web browser (open pages, search, navigate, read content, watch videos, control video playback, scroll, click, close tabs, find elements on page)
2. **jetbrains** - Controls IDE (IntelliJ IDEA) - create files, edit code, run commands, manage projects

Analyze the user's transcribed speech and create specific prompts for the appropriate agents.

Output format (JSON):
{
  "original_text": "<the transcribed text>",
  "prompts": [
    {
      "agent": "browser" | "jetbrains",
      "prompt": "<specific action to perform>"
    }
  ]
}

Rules:
- If the user mentions browsing, searching, opening a website, reading web content, watching videos, video playback, scrolling, clicking, closing tabs, or any web/navigation action → include browser agent
- If the user mentions coding, files, IDE, running code, project management, code review, improvements, refactoring, analysis, or anything related to the codebase → include jetbrains agent
- If the speech is just a greeting with no actionable request (e.g. "hello", "hi") → prompts array can be empty
- When in doubt, route to jetbrains agent. Prefer generating a prompt over returning empty.
- Always preserve the original transcribed text exactly
- Make prompts specific and actionable
- Use English for prompts regardless of the input language
- Output only valid JSON, no additional text
- NEVER return empty prompts for valid commands - always include at least one agent if the user is asking to do something
- Common commands to recognize:
  - "scroll" / "scroll down" / "scroll up" → browser agent
  - "open" / "go to" / "navigate to" → browser agent
  - "search" / "find" → browser agent
  - "click" / "press" → browser agent
  - "close" / "close the browser" → browser agent
`;

export class OrchestratorAgent {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
    });
    this.model = 'grok-4-1-fast-non-reasoning';
  }

  async process(transcription: string): Promise<OrchestratorResult> {
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
      console.error(`[orchestrator] Translation error: ${error}`);
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Analyze this transcribed speech and output JSON with agent prompts: ${translatedText}`,
          },
        ],
        temperature: 0.0,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from model');
      }

      // Extract JSON from response (model may wrap in markdown fences or add extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      const result = JSON.parse(jsonMatch[0]);

      return {
        original_text: transcription,
        prompts: result.prompts || [],
      };
    } catch (error) {
      console.error(`[orchestrator] Error: ${error}`);
      return {
        original_text: transcription,
        prompts: [],
      };
    }
  }
}
