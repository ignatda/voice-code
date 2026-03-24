import { Agent } from '@openai/agents';
import { MCPServerStdio } from '@openai/agents';
import type { AppContext } from '../context.js';
import { getAgentModel } from '../../core/providers.js';

// Browser = precise tool calling, needs strong models
const MODELS: Record<string, string> = {
  xai:    'grok-4.20-0309-non-reasoning',
  gemini: 'gemini-3.1-pro-preview',
  groq:   'openai/gpt-oss-120b',
};
import logger from '../../core/logger.js';
import { ensureProvider } from '../provider.js';
import { readOnlyGuardrail } from '../guardrails.js';

function getMcpConfig(headless = false) {
  return {
    command: 'npx',
    args: ['-y', '@playwright/mcp', '--image-responses', 'omit',
      ...(headless ? ['--headless'] : [])],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
    timeout: 60000,
  };
}

const INSTRUCTIONS = `You are a browser automation agent using Playwright.

You have access to browser automation tools via MCP. Use these tools to:
- Navigate to URLs
- Take accessibility snapshots of pages (browser_snapshot)
- Click elements, fill forms
- Extract page content, execute JavaScript, scroll pages
- Close tabs or the browser

CRITICAL RULES:
- You MUST call at least one tool for EVERY request. Never just say you did something — actually do it.
- If the user says "open the browser" without a URL, navigate to about:blank to ensure the browser window appears.
- If the user says "close" a site/tab, use browser_tab_close or browser_close to actually close it.
- When navigating, always call browser_navigate with the URL.

When the user asks to browse, search, or interact with a webpage:
1. Use browser_navigate to go to the URL
2. Use browser_snapshot to see the page structure (preferred over screenshots)
3. Use browser_click, browser_fill_form, or other tools to interact
4. Report results back

Always provide feedback on what actions were taken.`;

let mcpServer: MCPServerStdio | null = null;
let mcpConnected = false;

export async function resetBrowserMcp(): Promise<void> {
  if (mcpServer) {
    try { await mcpServer.close(); } catch {}
    mcpServer = null;
    mcpConnected = false;
    logger.info('[browser_agent] MCP server reset (headless mode changed)');
  }
}

async function ensureMcp(): Promise<MCPServerStdio> {
  if (!mcpServer) {
    mcpServer = new MCPServerStdio({ name: 'Playwright Browser', ...getMcpConfig() });
  }
  if (!mcpConnected) {
    await mcpServer.connect();
    mcpConnected = true;
    logger.info('[browser_agent] MCP server connected');
  }
  return mcpServer;
}

export async function createBrowserAgent(readOnly = false): Promise<Agent<AppContext>> {
  ensureProvider();
  const mcp = await ensureMcp();
  return new Agent<AppContext>({
    name: 'Browser Agent',
    handoffDescription: 'Controls web browser — browsing, navigation, searching, clicking, scrolling, page interaction.',
    instructions: INSTRUCTIONS,
    mcpServers: [mcp],
    model: getAgentModel(MODELS),
    inputGuardrails: readOnly ? [readOnlyGuardrail] : [],
  });
}
