import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');
const AGENTS_MD_PATH = path.resolve(__dirname, '..', '..', '..', 'AGENTS.md');

// ── Provider registry ───────────────────────────────────────────────────────

export interface ProviderConfig {
  name: string;
  apiKey: string;
  baseURL: string;
  model: string;
}

const PROVIDER_REGISTRY: Record<string, { baseURL: string; defaultModel: string; keyEnv: string }> = {
  xai:    { baseURL: 'https://api.x.ai/v1',                                    defaultModel: 'grok-4-1-fast-non-reasoning', keyEnv: 'XAI_API_KEY' },
  gemini: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', defaultModel: 'gemini-3-flash-preview',            keyEnv: 'GEMINI_API_KEY' },
  groq:   { baseURL: 'https://api.groq.com/openai/v1',                         defaultModel: 'llama-3.3-70b-versatile',     keyEnv: 'GROQ_API_KEY' },
};

export function getProviderConfigs(): ProviderConfig[] {
  const list = (process.env.LLM_PROVIDERS || '').split(',').map(s => s.trim()).filter(Boolean);
  return list
    .filter(name => PROVIDER_REGISTRY[name])
    .map(name => {
      const reg = PROVIDER_REGISTRY[name];
      return { name, apiKey: process.env[reg.keyEnv] || '', baseURL: reg.baseURL, model: reg.defaultModel };
    })
    .filter(c => c.apiKey);
}

export function bootstrapPrimaryProvider(): void {
  const configs = getProviderConfigs();
  if (configs.length === 0) return;
  const primary = configs[0];
  process.env.OPENAI_API_KEY = primary.apiKey;
  process.env.OPENAI_BASE_URL = primary.baseURL;
  process.env.OPENAI_MODEL = primary.model;
}

// ── Env loading ─────────────────────────────────────────────────────────────

export function loadEnv(): void {
  dotenv.config({ path: ENV_PATH, override: true });
}

export interface ValidationResult {
  valid: boolean;
  missing: string[];
  errors: string[];
}

export function validateEnv(): ValidationResult {
  const errors: string[] = [];
  const missing: string[] = [];

  if (!process.env.LLM_PROVIDERS) missing.push('LLM_PROVIDERS');

  const configs = getProviderConfigs();
  if (process.env.LLM_PROVIDERS && configs.length === 0) {
    errors.push('No valid API keys found for providers listed in LLM_PROVIDERS');
  }

  if (missing.length) errors.push(`Missing required env vars: ${missing.join(', ')}`);

  return { valid: errors.length === 0, missing, errors };
}

export function writeEnv(updates: Record<string, string>): void {
  let content = '';
  try {
    content = fs.readFileSync(ENV_PATH, 'utf-8');
  } catch { /* file may not exist */ }

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `${content.endsWith('\n') || !content ? '' : '\n'}${key}=${value}\n`;
    }
  }

  fs.writeFileSync(ENV_PATH, content, 'utf-8');
  loadEnv();
}

const maskKey = (key: string) => key ? '••••' + key.slice(-4) : '';

/** Keys safe to expose via GET */
export function getSettingsSnapshot(): Record<string, string> {
  return {
    LLM_PROVIDERS: process.env.LLM_PROVIDERS || '',
    XAI_API_KEY: maskKey(process.env.XAI_API_KEY || ''),
    GEMINI_API_KEY: maskKey(process.env.GEMINI_API_KEY || ''),
    GROQ_API_KEY: maskKey(process.env.GROQ_API_KEY || ''),
    STT_PROVIDER: process.env.STT_PROVIDER || 'xai',
    TTS_PROVIDER: process.env.TTS_PROVIDER || process.env.STT_PROVIDER || 'xai',
    TTS_MAX_LENGTH: process.env.TTS_MAX_LENGTH || '500',
    PORT: process.env.PORT || '5000',
    CODING_CLI: process.env.CODING_CLI || 'opencode',
    IDE_TYPE: process.env.IDE_TYPE || 'jetbrains',
    EXTENSIONS: process.env.EXTENSIONS || 'none',
    SCHEDULED_TASKS: process.env.SCHEDULED_TASKS || 'none',
  };
}

// ── XAI / Agent config ──────────────────────────────────────────────────────

export const getXAIConfig = () => ({
  apiKey: process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.x.ai/v1',
  model: process.env.OPENAI_MODEL || 'grok-4-1-fast-non-reasoning',
});

let agentsMdCache: string | null = null;

export function getAgentsMd(): string {
  if (agentsMdCache === null) {
    try { agentsMdCache = fs.readFileSync(AGENTS_MD_PATH, 'utf-8'); } catch { agentsMdCache = ''; }
  }
  return agentsMdCache;
}
