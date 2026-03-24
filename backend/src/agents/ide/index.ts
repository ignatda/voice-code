import { Agent } from '@openai/agents';
import { MCPServerStdio } from '@openai/agents';
import type { AppContext } from '../context.js';
import { getAgentsMd } from '../../core/config.js';
import { getAgentModel } from '../../core/providers.js';

// IDE = coding tasks, needs strong tool calling + reasoning
const MODELS: Record<string, string> = {
  xai:    'grok-4.20-0309-non-reasoning',
  gemini: 'gemini-3.1-pro-preview',
  groq:   'openai/gpt-oss-120b',
};
import logger from '../../core/logger.js';
import { ensureProvider } from '../provider.js';
import { readOnlyGuardrail } from '../guardrails.js';
import { jetbrainsMcpConfig } from './mcp/jetbrains.js';
import { vscodeMcpConfig } from './mcp/vscode.js';
import { getCliFunctionTool } from './tools/cli.js';

export type IDEType = 'jetbrains' | 'vscode' | 'none';

export const getIDEType = (): IDEType => {
  const v = (process.env.IDE_TYPE || 'jetbrains').toLowerCase();
  if (v === 'vscode' || v === 'none') return v;
  return 'jetbrains';
};

const MCP_CONFIGS: Record<string, { name: string; command: string; args: string[]; env?: Record<string, string>; timeout: number }> = {
  jetbrains: jetbrainsMcpConfig,
  vscode: vscodeMcpConfig,
};

const getInstructions = (ideType: IDEType) => {
  const hasMCP = ideType !== 'none';
  const hasCli = !!getCliFunctionTool();
  const ideName = ideType === 'jetbrains' ? 'IntelliJ IDEA' : ideType === 'vscode' ? 'VS Code' : 'no IDE';
  const cliName = process.env.CODING_CLI === 'kiro-cli' ? 'run_kiro' : 'run_opencode';

  if (!hasMCP && !hasCli) {
    return `You are a coding assistant (no IDE, no CLI tools).
You can only answer questions, explain code, and discuss architecture.
You have NO tools to read, write, or navigate files.
${getAgentsMd()}`;
  }

  if (!hasMCP) {
    return `You are a coding agent with no direct IDE access. You delegate ALL tasks to the coding CLI.
Use the \`${cliName}\` tool. Pass the full prompt as the \`prompt\` parameter.
Set \`continueSession: true\` on subsequent calls.
- NEVER ask clarifying questions. Delegate to the CLI and let it discover information.
${getAgentsMd()}`;
  }

  if (!hasCli) {
    return `You are an IDE control agent for ${ideName}.
You have access to IDE tools via MCP. You handle ALL tasks directly — navigation, reading, AND coding.
- Open files, navigate to symbols, search in project, read file contents
- Create, edit, rename, reformat files
- Build the project and check for errors after changes
- NEVER ask clarifying questions. Use available tools to discover information.
${getAgentsMd()}`;
  }

  return `You are an IDE control agent for ${ideName}. You act as a dispatcher that simulates human hands.

## Direct IDE actions (use MCP tools directly):
- Open files, navigate to symbols or lines
- Search in project, read file contents
- Get project structure, list directory trees
- Get file problems / diagnostics
- Create, edit, rename, reformat files

## Coding CLI (use \`${cliName}\` tool):
For ANY code writing, editing, refactoring, or generation task, use the coding CLI tool.
Pass the full prompt as the \`prompt\` parameter. Set \`continueSession: true\` on subsequent calls.

## RULES:
- NEVER write or edit code yourself. Always delegate coding to the CLI tool.
- For IDE navigation/reading tasks, use MCP tools directly.
- NEVER ask clarifying questions. Use available tools to discover information.

## Post-CLI IDE Actions:
When CLI output contains a \`KIRO_IDE_ACTIONS_BEGIN\`/\`END\` or \`OPENCODE_IDE_ACTIONS_BEGIN\`/\`END\` block, parse the JSON and execute each action:
- \`"open:<path>"\` → open_file_in_editor
- \`"reformat:<path>"\` → reformat_file
- \`"build"\` → build_project
- \`"problems:<path>"\` → get_file_problems

${getAgentsMd()}`;
};

let mcpServer: MCPServerStdio | null = null;
let mcpConnected = false;

async function ensureMcp(ideType: IDEType): Promise<MCPServerStdio | null> {
  const mcpConfig = MCP_CONFIGS[ideType];
  if (!mcpConfig) return null;
  if (!mcpServer) {
    mcpServer = new MCPServerStdio({ name: mcpConfig.name, command: mcpConfig.command, args: mcpConfig.args, env: mcpConfig.env, timeout: mcpConfig.timeout });
  }
  if (!mcpConnected) {
    await mcpServer.connect();
    mcpConnected = true;
    logger.info(`[ide_agent] MCP server connected (${ideType})`);
  }
  return mcpServer;
}

export async function createIDEAgent(readOnly = false): Promise<Agent<AppContext>> {
  ensureProvider();
  const ideType = getIDEType();
  const mcp = await ensureMcp(ideType);
  const cliTool = getCliFunctionTool();

  return new Agent<AppContext>({
    name: 'IDE Agent',
    handoffDescription: 'Controls IDE — coding, file editing, navigation, running commands, project management.',
    instructions: getInstructions(ideType),
    mcpServers: mcp ? [mcp] : [],
    tools: cliTool ? [cliTool] : [],
    model: getAgentModel(MODELS),
    inputGuardrails: readOnly ? [readOnlyGuardrail] : [],
  });
}

/** Send Ctrl+C to IDE terminal (for stop-all). */
export async function killTerminalProcess(): Promise<void> {
  if (!mcpServer || !mcpConnected) return;
  try {
    await mcpServer.callTool('execute_terminal_command', {
      command: '\x03',
      reuseExistingTerminalWindow: true,
      timeout: 3000,
    });
  } catch (e) {
    logger.info(`[ide_agent] Terminal kill attempt: ${e}`);
  }
}
