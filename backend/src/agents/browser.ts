import { Agent, run, setDefaultModelProvider, OpenAIProvider } from '@openai/agents';
import { MCPServerStdio } from '@openai/agents';
import type { BrowserResult } from '../types';
import { getXAIConfig } from './config.js';
import { log, logError } from '../log.js';

const PLAYWRIGHT_MCP_CONFIG = {
  command: 'npx',
  args: ['-y', '@playwright/mcp', '--image-responses', 'omit'],
  env: {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ':0',
  },
  timeout: 60000
};

const BROWSER_AGENT_INSTRUCTIONS = `You are a browser automation agent using Playwright.

You have access to browser automation tools via MCP. Use these tools to:
- Navigate to URLs
- Take accessibility snapshots of pages (browser_snapshot)
- Click elements
- Fill forms
- Extract page content
- Execute JavaScript
- Scroll pages

When the user asks to browse, search, or interact with a webpage:
1. Use browser_navigate to go to the URL
2. Use browser_snapshot to see the page structure (preferred over screenshots)
3. Use browser_click, browser_fill_form, or other tools to interact
4. Report results back

Always provide feedback on what actions were taken.`;

const getBrowserInstructions = (readOnly = false) => {
  if (readOnly) {
    return `You are a browser automation agent using Playwright in READ-ONLY mode.

You can ONLY perform read/view operations:
- Navigate to URLs
- Take accessibility snapshots of pages (browser_snapshot)
- Extract page content
- Scroll pages

STRICTLY FORBIDDEN in read-only mode:
- NEVER click elements, fill forms, or submit data
- NEVER execute JavaScript that modifies page state
- If the user asks to interact (click, fill, submit), respond: "Cannot interact with page — read-only mode is active. Toggle edit mode to allow interactions."

Always provide feedback on what actions were taken.`;
  }

  return BROWSER_AGENT_INSTRUCTIONS;
};

let mcpServer: MCPServerStdio | null = null;
let browserAgent: Agent | null = null;
let clientInitialized = false;
let mcpConnected = false;

function initializeClient(): void {
  if (clientInitialized) return;
  
  const config = getXAIConfig();
  const provider = new OpenAIProvider({ 
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    useResponses: false,
  });
  
  setDefaultModelProvider(provider);
  clientInitialized = true;
  log('[browser_agent] OpenAI provider initialized with x.ai (chat completions), baseURL: ' + config.baseURL);
}

async function getAgent(readOnly = false): Promise<Agent> {
  initializeClient();
  
  if (!mcpServer) {
    mcpServer = new MCPServerStdio({
      name: 'Playwright Browser',
      ...PLAYWRIGHT_MCP_CONFIG
    });
  }

  if (!mcpConnected) {
    await mcpServer.connect();
    mcpConnected = true;
    log('[browser_agent] MCP server connected');
  }

  browserAgent = new Agent({
    name: 'Browser Agent',
    instructions: getBrowserInstructions(readOnly),
    mcpServers: [mcpServer],
    model: getXAIConfig().model
  });

  return browserAgent;
}

export class BrowserAgent {
  private initialized: boolean = false;
  private initError: string | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      await getAgent(false);
      this.initialized = true;
      log('[browser_agent] Initialized successfully');
    } catch (error) {
      this.initError = String(error);
      logError(`[browser_agent] Initialization error: ${error}`);
      throw error;
    }
  }

  async process(prompt: string, signal?: AbortSignal, readOnly = false): Promise<BrowserResult> {
    log(`[browser_agent] Received prompt: ${prompt} (readOnly=${readOnly})`);

    if (!this.initialized) {
      try {
        await this.initialize();
      } catch {
        return {
          status: 'error',
          message: `Failed to initialize browser agent: ${this.initError}`,
          error: this.initError || 'Unknown error'
        };
      }
    }

    try {
      const agent = await getAgent(readOnly);
      const result = await run(agent, prompt, { signal });
      
      return {
        status: 'success',
        message: result.finalOutput || 'Browser command executed successfully',
      };
    } catch (error) {
      if (signal?.aborted) {
        return { status: 'error', message: 'Interrupted by user' };
      }
      logError(`[browser_agent] Error: ${error}`);
      return {
        status: 'error',
        error: String(error)
      };
    }
  }
}
