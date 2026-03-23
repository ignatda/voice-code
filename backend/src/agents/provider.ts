import { setDefaultModelProvider, OpenAIProvider } from '@openai/agents';
import { getXAIConfig } from '../core/config.js';
import logger from '../core/logger.js';

let initialized = false;

export function ensureProvider(): void {
  if (initialized) return;
  const config = getXAIConfig();
  setDefaultModelProvider(new OpenAIProvider({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    useResponses: false,
  }));
  initialized = true;
  logger.info('[provider] OpenAI provider initialized, baseURL: ' + config.baseURL);
}
