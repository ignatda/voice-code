import { Agent, run, setDefaultModelProvider, OpenAIProvider } from '@openai/agents';
import { MCPServerStdio } from '@openai/agents';
import type { JetBrainsResult } from '../types';

// Read env vars lazily to ensure dotenv has loaded
const getXAIConfig = () => ({
  apiKey: process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.x.ai/v1',
  model: process.env.OPENAI_MODEL || 'grok-4-1-fast-non-reasoning',
});

const JETBRAINS_MCP_CONFIG = {
  command: '/snap/intellij-idea-ultimate/730/jbr/bin/java',
  args: [
    '-classpath',
    '/snap/intellij-idea-ultimate/730/plugins/mcpserver/lib/mcpserver-frontend.jar:/snap/intellij-idea-ultimate/730/lib/util-8.jar:/snap/intellij-idea-ultimate/730/lib/module-intellij.libraries.ktor.client.cio.jar:/snap/intellij-idea-ultimate/730/lib/module-intellij.libraries.ktor.client.jar:/snap/intellij-idea-ultimate/730/lib/module-intellij.libraries.ktor.network.tls.jar:/snap/intellij-idea-ultimate/730/lib/module-intellij.libraries.ktor.io.jar:/snap/intellij-idea-ultimate/730/lib/module-intellij.libraries.ktor.utils.jar:/snap/intellij-idea-ultimate/730/lib/module-intellij.libraries.kotlinx.io.jar:/snap/intellij-idea-ultimate/730/lib/module-intellij.libraries.kotlinx.serialization.core.jar:/snap/intellij-idea-ultimate/730/lib/module-intellij.libraries.kotlinx.serialization.json.jar',
    'com.intellij.mcpserver.stdio.McpStdioRunnerKt'
  ],
  env: {
    IJ_MCP_SERVER_PORT: '64342'
  },
  timeout: 60000
};

const JETBRAINS_AGENT_INSTRUCTIONS = `You are an IDE control agent for IntelliJ IDEA.

You have access to JetBrains IDE tools via MCP. Use these tools to:
- Read, create, and edit files in the project
- Run terminal commands
- Search for code patterns
- Navigate the project structure
- Execute code and tests

When the user asks to do something with code, files, or the IDE:
1. Analyze what needs to be done
2. Use the appropriate tools to accomplish the task
3. Report the results back to the user

IMPORTANT RULES:
- NEVER ask clarifying questions. Always use available tools to discover information yourself.
- If you need the project path, use tools to find it.
- If a request is ambiguous, make your best judgment and proceed.
- Always be precise with file paths and commands.`;

let mcpServer: MCPServerStdio | null = null;
let jetbrainsAgent: Agent | null = null;
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
  console.log('[jetbrains_agent] OpenAI provider initialized with x.ai (chat completions), baseURL:', config.baseURL);
}

async function getAgent(): Promise<Agent> {
  initializeClient();
  
  if (!mcpServer) {
    mcpServer = new MCPServerStdio({
      name: 'JetBrains IDE',
      ...JETBRAINS_MCP_CONFIG
    });
  }

  if (!mcpConnected) {
    await mcpServer.connect();
    mcpConnected = true;
    console.log('[jetbrains_agent] MCP server connected');
  }

  if (!jetbrainsAgent) {
    jetbrainsAgent = new Agent({
      name: 'JetBrains Agent',
      instructions: JETBRAINS_AGENT_INSTRUCTIONS,
      mcpServers: [mcpServer],
      model: getXAIConfig().model
    });
  }

  return jetbrainsAgent;
}

export class JetBrainsAgent {
  private initialized: boolean = false;
  private initError: string | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      const agent = await getAgent();
      await agent;
      this.initialized = true;
      console.log('[jetbrains_agent] Initialized successfully');
    } catch (error) {
      this.initError = String(error);
      console.error('[jetbrains_agent] Initialization error:', error);
      throw error;
    }
  }

  async process(prompt: string): Promise<JetBrainsResult> {
    console.log(`[jetbrains_agent] Received prompt: ${prompt}`);

    if (!this.initialized) {
      try {
        await this.initialize();
      } catch {
        return {
          agent: 'jetbrains',
          status: 'error',
          message: `Failed to initialize JetBrains agent: ${this.initError}`,
          received_prompt: prompt
        };
      }
    }

    try {
      const agent = await getAgent();
      const result = await run(agent, prompt);
      
      const message = result.finalOutput || 'Command executed successfully';
      console.log(`[jetbrains_agent] Completed: ${message.slice(0, 200)}`);

      return {
        agent: 'jetbrains',
        status: 'success',
        message,
        received_prompt: prompt
      };
    } catch (error) {
      console.error('[jetbrains_agent] Error:', error);
      return {
        agent: 'jetbrains',
        status: 'error',
        message: String(error),
        received_prompt: prompt
      };
    }
  }
}
