import { Agent, run, type InputGuardrail } from '@openai/agents';
import { getAgentModel } from '../core/providers.js';
import { ensureProvider } from './provider.js';

const WRITE_PATTERNS = /\b(create|edit|delete|rename|write|modify|refactor|generate|implement|add|remove|update|replace|insert|append|build|fix|patch)\b/i;

/** Blocks write-intent prompts when read-only mode is active. */
export const readOnlyGuardrail: InputGuardrail = {
  name: 'read_only_mode',
  execute: async ({ input }) => {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    const triggered = WRITE_PATTERNS.test(text);
    return {
      tripwireTriggered: triggered,
      outputInfo: triggered ? 'Read-only mode is active. Write operations are blocked.' : null,
    };
  },
};

interface SafetyResult {
  harmful: boolean;
  refusal: string;
}

let _safetyAgent: Agent<unknown> | null = null;
function getSafetyAgent(): Agent<unknown> {
  if (!_safetyAgent) {
    ensureProvider();
    _safetyAgent = new Agent<unknown>({
      name: 'safety_classifier',
      instructions: `You are a safety and topic classifier. Determine if the user's message is harmful, illegal, or completely off-topic.
On-topic means: coding, programming, browser control, IDE control, or anything reasonably related.
Off-topic means: completely unrelated requests (e.g. cooking recipes, medical advice, dating tips).

If the message is in Russian, respond with a English refusal. Otherwise, respond in English.
Return JSON: { "harmful": true/false, "refusal": "<refusal message or empty string>" }`,
      outputType: {
        harmful: { type: 'boolean', description: 'Whether the request is harmful or off-topic' },
        refusal: { type: 'string', description: 'Refusal message in the user language, empty if not harmful' },
      } as any,
      model: getAgentModel(),
    });
  }
  return _safetyAgent;
}

/** Blocks harmful, illegal, or completely off-topic requests. */
export const safetyAndOfftopicGuardrail: InputGuardrail = {
  name: 'safety_and_offtopic',
  execute: async ({ input }) => {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    const result = await run(getSafetyAgent(), text);
    const output = result.finalOutput as unknown as SafetyResult;
    return {
      tripwireTriggered: output.harmful,
      outputInfo: output.harmful ? output.refusal : null,
    };
  },
};
