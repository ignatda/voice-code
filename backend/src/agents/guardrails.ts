import type { InputGuardrail } from '@openai/agents';

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
