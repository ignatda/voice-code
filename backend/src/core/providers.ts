import { setDefaultModelProvider, OpenAIProvider } from '@openai/agents';
import { getProviderConfigs, type ProviderConfig } from './config.js';
import logger from './logger.js';

let configs: ProviderConfig[] = [];
let index = 0;

function applyProvider(config: ProviderConfig): void {
  logger.info(`[providers] Applying provider=${config.name}, baseURL=${config.baseURL}, model=${config.model}`);
  setDefaultModelProvider(new OpenAIProvider({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    useResponses: false,
  }));
  process.env.OPENAI_API_KEY = config.apiKey;
  process.env.OPENAI_BASE_URL = config.baseURL;
  process.env.OPENAI_MODEL = config.model;
}

export function initPool(): void {
  configs = getProviderConfigs();
  if (configs.length === 0) {
    logger.warn('[providers] No LLM providers configured');
    return;
  }
  index = 0;
  applyProvider(configs[0]);
  logger.info(`[providers] Initialized with ${configs.length} provider(s): ${configs.map(c => c.name).join(', ')}`);
}

export function resetRotation(): void {
  if (configs.length === 0) return;
  index = 0;
  applyProvider(configs[0]);
}

/** Rotate to next provider. Returns false if all exhausted. */
export function rotateProvider(): boolean {
  if (index + 1 >= configs.length) return false;
  index++;
  const config = configs[index];
  applyProvider(config);
  logger.info(`[providers] Rotated to ${config.name} (${config.baseURL})`);
  return true;
}

export function getCurrentModel(): string {
  return configs[index]?.model || '';
}

export function getCurrentProviderName(): string {
  return configs[index]?.name || '';
}

/** Resolve model for a specific agent based on its per-provider model map. */
export function getAgentModel(agentModels?: Record<string, string>): string {
  const provider = getCurrentProviderName();
  if (agentModels && agentModels[provider]) return agentModels[provider];
  return getCurrentModel();
}
