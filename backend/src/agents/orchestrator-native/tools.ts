export interface RealtimeFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export function buildToolSchemas(opts: { ideType: string; codingCli: string }): RealtimeFunctionTool[] {
  const tools: RealtimeFunctionTool[] = [];

  if (opts.codingCli !== 'none') {
    tools.push({
      type: 'function',
      name: 'run_coding_cli',
      description: 'Execute a coding task via CLI. Pass the full prompt describing what to do.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The coding task prompt' },
          continueSession: { type: 'boolean', description: 'Continue an existing session' },
        },
        required: ['prompt'],
      },
    });
  }

  if (opts.ideType !== 'none') {
    tools.push({
      type: 'function',
      name: 'ide_action',
      description: 'Perform an IDE action: open files, search code, navigate, read files, build project, get diagnostics. Pass a natural language prompt describing what to do.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What to do in the IDE (e.g. "open file router.ts", "search for TODO comments", "list the project structure")' },
        },
        required: ['prompt'],
      },
    });
  }

  tools.push({
    type: 'function',
    name: 'browse_web',
    description: 'Browse the web: search, navigate to URLs, interact with pages, extract information. Pass a natural language prompt describing what to do.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to do in the browser (e.g. "search for weather in Belgrade", "open github.com and find the repo")' },
      },
      required: ['prompt'],
    },
  });

  tools.push({
    type: 'function',
    name: 'plan_feature',
    description: 'Design an implementation plan for a complex feature or architecture discussion.',
    parameters: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'The feature or design request' },
      },
      required: ['request'],
    },
  });

  return tools;
}
