import { z } from 'zod';
import { tool } from '@openai/agents';
import { execFile } from 'child_process';

const WRAPPER = new URL('./opencode-wrapper.sh', import.meta.url).pathname;

export const opencodeTool = tool({
  name: 'run_opencode',
  description: 'Execute a coding task via the opencode CLI. Pass the full prompt describing what to do.',
  parameters: z.object({
    prompt: z.string().describe('The coding task prompt'),
    continueSession: z.boolean().optional().describe('Whether to continue an existing session (-c flag)'),
  }),
  execute: async ({ prompt, continueSession }) => {
    const args = ['--auto-open-files', '--validate-build'];
    if (continueSession) args.push('-c');
    args.push('run', prompt);

    return new Promise<string>((resolve) => {
      execFile(WRAPPER, args, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
        if (err) resolve(`Error: ${err.message}\n${stderr}\n${stdout}`);
        else resolve(stdout);
      });
    });
  },
});
