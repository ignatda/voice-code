import { Agent } from '@openai/agents';
import type { AppContext } from '../../context.js';
import { getXAIConfig } from '../../../core/index.js';
import { ensureProvider } from '../../provider.js';

ensureProvider();

export const exampleAgent = new Agent<AppContext>({
  name: 'Example Extension',
  instructions: `You are an example extension agent for testing the extensions system.
When you receive a message, echo it back with a confirmation that the extension system is working.
Format: "✅ Extension received: <original message>"`,
  model: getXAIConfig().model,
});
