import crypto from 'node:crypto';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { taskRegistry } from './registry.js';
import logger from '../../core/logger.js';

export { taskRegistry } from './registry.js';
export type { TaskFn } from './registry.js';

/**
 * FunctionTool for background tasks. Agent decides when to call it.
 * Emits task_status events via the provided callback.
 */
export function getBackgroundTaskTool(onStatus: (event: { taskId: string; task: string; status: string; output?: string; message?: string }) => void) {
  return tool({
    name: 'run_background_task',
    description: `Run a long-running task in the background. Returns immediately with a task ID. Available tasks: ${[...taskRegistry.keys()].join(', ')}`,
    parameters: z.object({
      task: z.string().describe('Task name'),
      params: z.record(z.string(), z.string()).describe('Task parameters'),
    }),
    execute: async ({ task, params }) => {
      const fn = taskRegistry.get(task);
      if (!fn) return `Unknown task: ${task}. Available: ${[...taskRegistry.keys()].join(', ')}`;

      const taskId = crypto.randomUUID();
      // Fire-and-forget — agent gets immediate response
      fn(params)
        .then(output => onStatus({ taskId, task, status: 'completed', output }))
        .catch(err => {
          logger.error(`[tasks] ${task} failed: ${err}`);
          onStatus({ taskId, task, status: 'error', message: String(err) });
        });

      return `Task "${task}" started (id: ${taskId})`;
    },
  });
}
