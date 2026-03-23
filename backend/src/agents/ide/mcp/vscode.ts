export const vscodeMcpConfig = {
  name: 'VS Code',
  command: process.env.VS_CODE_MCP_CMD || 'npx',
  args: (process.env.VS_CODE_MCP_ARGS || '@anthropic/vscode-mcp-server --stdio').split(' '),
  env: {} as Record<string, string>,
  timeout: 60000,
};
