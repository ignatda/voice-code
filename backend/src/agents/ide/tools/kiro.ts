import { z } from 'zod';
import { tool } from '@openai/agents';
import { execFile } from 'child_process';

const WRAPPER = new URL('./kiro-wrapper.sh', import.meta.url).pathname;

export const kiroTool = tool({
  name: 'run_kiro',
  description: 'Execute a coding task via the kiro-cli. Pass the full prompt describing what to do.',
  parameters: z.object({
    prompt: z.string().describe('The coding task prompt'),
    continueSession: z.boolean().optional().describe('Whether to continue an existing session (--resume flag)'),
  }),
  execute: async ({ prompt, continueSession }) => {
    const args = ['--auto-open-files', '--validate-build', 'chat', '--no-interactive', '--trust-all-tools', '--model', 'claude-opus-4.6'];
    if (continueSession) args.push('--resume');
    args.push(prompt);

    return new Promise<string>((resolve) => {
      execFile(WRAPPER, args, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
        if (err) resolve(`Error: ${err.message}\n${stderr}\n${stdout}`);
        else resolve(stdout);
      });
    });
  },
});
