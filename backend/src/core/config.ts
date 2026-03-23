import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');
const AGENTS_MD_PATH = path.resolve(__dirname, '..', '..', '..', 'AGENTS.md');

// ── Env loading ─────────────────────────────────────────────────────────────

const REQUIRED_KEYS = ['OPENAI_API_KEY'] as const;

export interface ValidationResult {
  valid: boolean;
  missing: string[];
  errors: string[];
}

export function loadEnv(): void {
  dotenv.config({ path: ENV_PATH, override: true });
}

export function validateEnv(): ValidationResult {
  const missing: string[] = [];
  const errors: string[] = [];

  for (const key of REQUIRED_KEYS) {
    if (!process.env[key]) missing.push(key);
  }

  if (missing.length) errors.push(`Missing required env vars: ${missing.join(', ')}`);

  return { valid: missing.length === 0, missing, errors };
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

/** Keys safe to expose via GET */
export function getSettingsSnapshot(): Record<string, string> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  return {
    OPENAI_API_KEY: apiKey ? '••••' + apiKey.slice(-4) : '',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.x.ai/v1',
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
