import { Agent, run, setDefaultModelProvider, OpenAIProvider } from '@openai/agents';
import { MCPServerStdio } from '@openai/agents';
import type { BrowserResult } from '../types';

// Read env vars lazily to ensure dotenv has loaded
const getXAIConfig = () => ({
  apiKey: process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.x.ai/v1',
  model: process.env.OPENAI_MODEL || 'grok-4-1-fast-non-reasoning',
});

const PLAYWRIGHT_MCP_CONFIG = {
  command: 'npx',
  args: ['-y', '@playwright/mcp'],
  env: {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ':0',
  },
  timeout: 60000
};

const BROWSER_AGENT_INSTRUCTIONS = `You are a browser automation agent using Playwright.

You have access to browser automation tools via MCP. Use these tools to:
- Navigate to URLs
- Take screenshots
- Click elements
- Fill forms
- Extract page content
- Execute JavaScript
- Scroll pages

When the user asks to browse, search, or interact with a webpage:
1. Use playwright_navigate to go to the URL
2. Use playwright_screenshot to see the page
3. Use playwright_click, playwright_fill, or other tools to interact
4. Report results back

Always provide feedback on what actions were taken.`;

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
  console.log('[browser_agent] OpenAI provider initialized with x.ai (chat completions), baseURL:', config.baseURL);
}

async function getAgent(): Promise<Agent> {
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
    console.log('[browser_agent] MCP server connected');
  }

  if (!browserAgent) {
    browserAgent = new Agent({
      name: 'Browser Agent',
      instructions: BROWSER_AGENT_INSTRUCTIONS,
      mcpServers: [mcpServer],
      model: getXAIConfig().model
    });
  }

  return browserAgent;
}

export class BrowserAgent {
  private initialized: boolean = false;
  private initError: string | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      const agent = await getAgent();
      await agent;
      this.initialized = true;
      console.log('[browser_agent] Initialized successfully');
    } catch (error) {
      this.initError = String(error);
      console.error('[browser_agent] Initialization error:', error);
      throw error;
    }
  }

  async process(prompt: string): Promise<BrowserResult> {
    console.log(`[browser_agent] Received prompt: ${prompt}`);

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
      const agent = await getAgent();
      const result = await run(agent, prompt);
      
      return {
        status: 'success',
        message: result.finalOutput || 'Browser command executed successfully',
      };
    } catch (error) {
      console.error('[browser_agent] Error:', error);
      return {
        status: 'error',
        error: String(error)
      };
    }
  }
}
