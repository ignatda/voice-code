import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_MD_PATH = path.resolve(__dirname, '..', '..', '..', 'AGENTS.md');

let agentsMdCache: string | null = null;

// Read env vars lazily to ensure dotenv has loaded
export const getXAIConfig = () => ({
  apiKey: process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.x.ai/v1',
  model: process.env.OPENAI_MODEL || 'grok-4-1-fast-non-reasoning',
});

export function getAgentsMd(): string {
  if (agentsMdCache === null) {
    try { agentsMdCache = fs.readFileSync(AGENTS_MD_PATH, 'utf-8'); } catch { agentsMdCache = ''; }
  }
  return agentsMdCache;
}
