import type { Agent } from '@openai/agents';
import { handoff } from '@openai/agents';
import type { AppContext } from '../context.js';
import logger from '../../core/logger.js';

interface CoreAgents {
  browser: Agent<AppContext>;
  ide: Agent<AppContext>;
  planner: Agent<AppContext>;
}

/**
 * Register extension agents. Returns extra handoffs for the orchestrator.
 * Only registers agents listed in EXTENSIONS env var.
 */
export async function registerExtensions(core: CoreAgents): Promise<any[]> {
  const enabled = (process.env.EXTENSIONS || 'none').split(',').map(s => s.trim());
  if (enabled.includes('none') || enabled.length === 0) return [];

  const extraHandoffs: any[] = [];

  if (enabled.includes('example')) {
    const { exampleAgent } = await import('./example/index.js');
    extraHandoffs.push(
      handoff(exampleAgent, { toolDescriptionOverride: 'Hand off to Example Agent for testing the extensions system.' }),
    );
    logger.info('[extensions] Registered: example');
  }

  return extraHandoffs;
}
