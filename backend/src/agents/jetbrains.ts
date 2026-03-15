import { Agent, run, setDefaultModelProvider, OpenAIProvider } from '@openai/agents';
import { MCPServerStdio } from '@openai/agents';
import type { JetBrainsResult } from '../types';

// Read env vars lazily to ensure dotenv has loaded
const getXAIConfig = () => ({
  apiKey: process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.x.ai/v1',
  model: process.env.OPENAI_MODEL || 'grok-4-1-fast-non-reasoning',
});

const CLI_TOOLS: Record<string, { bin: string; run: string; continueFlag: string }> = {
  opencode: {
    bin: '/home/dsherstobitov/.opencode/bin/opencode',
    run: 'run',
    continueFlag: '-c',
  },
  'kiro-cli': {
    bin: '/home/dsherstobitov/.local/bin/kiro-cli',
    run: 'chat --no-interactive --trust-all-tools',
    continueFlag: '--resume',
  },
};

const getCliTool = () => {
  const name = process.env.CODING_CLI || 'opencode';
  return CLI_TOOLS[name] || CLI_TOOLS['opencode'];
};

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

const getJetBrainsInstructions = () => {
  const cli = getCliTool();
  return `You are an IDE control agent for IntelliJ IDEA.

You have access to JetBrains IDE tools via MCP. You act as a dispatcher that simulates human hands.

## Two modes of operation:

### 1. Direct IDE actions (use MCP tools directly):
- Open/close files
- Navigate to symbols or lines
- Search in project
- Read file contents
- Get project structure
- Any IDE UI action

### 2. Coding tasks (delegate to AI CLI in terminal):
For ANY code writing, editing, refactoring, or generation task, use the execute_terminal_command tool to run the coding CLI.

First coding command in a conversation:
\`${cli.bin} ${cli.run} "<detailed coding instruction>"\`

All subsequent coding commands (to keep context of previous changes):
\`${cli.bin} ${cli.run} ${cli.continueFlag} "<follow-up instruction>"\`

IMPORTANT: Always use execute_terminal_command with these parameters:
- command: the CLI command above
- executeInShell: true
- timeout: 120000

## RULES:
- NEVER write or edit code yourself. Always delegate coding to the CLI.
- NEVER ask clarifying questions. Use available tools to discover information.
- For coding tasks, pass the full detailed prompt to the CLI.
- For IDE navigation/reading tasks, use MCP tools directly.
- Use ${cli.continueFlag} on every coding command EXCEPT the very first one in a conversation.`;
};

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
      instructions: getJetBrainsInstructions(),
      mcpServers: [mcpServer],
      model: getXAIConfig().model
    });
  }

  return jetbrainsAgent;
}

export class JetBrainsAgent {
  private initialized: boolean = false;
  private initError: string | null = null;
  private hasActiveSession: boolean = false;

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
    const cli = getCliTool();
    const sessionHint = this.hasActiveSession
      ? `\n[CONTEXT: A coding CLI session already exists. Use ${cli.continueFlag} flag for any coding commands.]`
      : '\n[CONTEXT: No coding CLI session yet. Do NOT use the continue flag for the first coding command.]';
    const augmentedPrompt = prompt + sessionHint;

    console.log(`[jetbrains_agent] Received prompt: ${prompt} (hasActiveSession=${this.hasActiveSession})`);

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
      const result = await run(agent, augmentedPrompt);
      
      const toolCalls = result.newItems
        .filter((item: any) => item.type === 'tool_call_item')
        .map((item: any) => item.rawItem?.name || 'unknown');
      if (toolCalls.length > 0) {
        console.log(`[jetbrains_agent] Tools used: ${toolCalls.join(', ')}`);
      }

      this.hasActiveSession = true;
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
