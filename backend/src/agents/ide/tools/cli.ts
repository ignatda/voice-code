import type { FunctionTool } from '@openai/agents';
import { opencodeTool } from './opencode.js';
import { kiroTool } from './kiro.js';

const CLI_FUNCTION_TOOLS: Record<string, FunctionTool<any, any, any>> = {
  opencode: opencodeTool,
  'kiro-cli': kiroTool,
};

export function getCliFunctionTool(): FunctionTool<any, any, any> | null {
  const name = process.env.CODING_CLI || 'opencode';
  if (name === 'none') return null;
  return CLI_FUNCTION_TOOLS[name] || CLI_FUNCTION_TOOLS['opencode'];
}
