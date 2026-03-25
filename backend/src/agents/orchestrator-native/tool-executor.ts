import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { Runner } from '@openai/agents';
import logger from '../../core/logger.js';
import { getXAIConfig } from '../../core/config.js';
import { createBrowserAgent } from '../browser/index.js';
import { createIDEAgent } from '../ide/index.js';
import { createPlannerAgent } from '../planner/index.js';
import type { AppContext } from '../context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENCODE_WRAPPER = path.resolve(__dirname, '..', 'ide', 'tools', 'opencode-wrapper.sh');
const KIRO_WRAPPER = path.resolve(__dirname, '..', 'ide', 'tools', 'kiro-wrapper.sh');

// Cached agents (lazily created)
let browserAgent: any = null;
let ideAgent: any = null;
let plannerAgent: any = null;

async function ensureBrowserAgent() {
  if (!browserAgent) browserAgent = await createBrowserAgent(false);
  return browserAgent;
}

async function ensureIDEAgent() {
  if (!ideAgent) ideAgent = await createIDEAgent(false);
  return ideAgent;
}

async function ensurePlannerAgent() {
  if (!plannerAgent) plannerAgent = createPlannerAgent();
  return plannerAgent;
}

async function runAgent(agent: any, prompt: string, sid: string): Promise<string> {
  const context: AppContext = {
    config: getXAIConfig(),
    logger,
    readOnly: false,
    sessionId: sid,
  };
  const result = await new Runner().run(agent, prompt, { context, maxTurns: 15 });
  return result.finalOutput || 'Done.';
}

export async function executeTool(
  name: string, args: Record<string, any>, opts: { ideType: string; codingCli: string; sid: string },
): Promise<string> {
  logger.info({ sid: opts.sid }, `[native] Executing tool: ${name}`);

  switch (name) {
    case 'run_coding_cli':
      return runCodingCli(args, opts);
    case 'ide_action':
      return runIDEAction(args, opts);
    case 'browse_web':
      return runBrowseWeb(args, opts);
    case 'plan_feature':
      return runPlanFeature(args, opts);
    default:
      return `Unknown tool: ${name}`;
  }
}

async function runCodingCli(args: Record<string, any>, opts: { codingCli: string; sid: string }): Promise<string> {
  const wrapper = opts.codingCli === 'kiro-cli' ? KIRO_WRAPPER : OPENCODE_WRAPPER;
  const cliArgs = opts.codingCli === 'kiro-cli'
    ? ['--auto-open-files', '--validate-build', 'chat', '--no-interactive', '--trust-all-tools', '--model', 'claude-opus-4.6', ...(args.continueSession ? ['--resume'] : []), args.prompt]
    : ['--auto-open-files', '--validate-build', ...(args.continueSession ? ['-c'] : []), 'run', args.prompt];

  return new Promise<string>((resolve) => {
    execFile(wrapper, cliArgs, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (err) resolve(`Error: ${err.message}\n${stderr}\n${stdout}`);
      else resolve(stdout || 'Done.');
    });
  });
}

async function runIDEAction(args: Record<string, any>, opts: { ideType: string; sid: string }): Promise<string> {
  if (opts.ideType === 'none') return 'IDE not available.';
  const agent = await ensureIDEAgent();
  const prompt = args.prompt || args.query || `${args.action}${args.path ? ': ' + args.path : ''}`;
  try {
    return await runAgent(agent, prompt, opts.sid);
  } catch (e: any) {
    return `IDE error: ${e.message}`;
  }
}

async function runBrowseWeb(args: Record<string, any>, opts: { sid: string }): Promise<string> {
  const agent = await ensureBrowserAgent();
  const prompt = args.prompt || args.query || `${args.action}${args.url ? ' ' + args.url : ''}`;
  try {
    return await runAgent(agent, prompt, opts.sid);
  } catch (e: any) {
    return `Browser error: ${e.message}`;
  }
}

async function runPlanFeature(args: Record<string, any>, opts: { sid: string }): Promise<string> {
  const agent = await ensurePlannerAgent();
  try {
    return await runAgent(agent, args.request, opts.sid);
  } catch (e: any) {
    return `Planner error: ${e.message}`;
  }
}
