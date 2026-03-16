import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');

const REQUIRED_KEYS = ['OPENAI_API_KEY'] as const;
const DEFAULTS: Record<string, string> = {};

export interface ValidationResult {
  valid: boolean;
  missing: string[];
  errors: string[];
}

export function loadEnv(): void {
  dotenv.config({ path: ENV_PATH, override: true });
  for (const [key, val] of Object.entries(DEFAULTS)) {
    if (!process.env[key]) process.env[key] = val;
  }
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
  };
}
