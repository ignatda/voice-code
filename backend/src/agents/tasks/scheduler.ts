import type { Agent } from '@openai/agents';
import { run } from '@openai/agents';
import type { AppContext } from '../context.js';
import { schedules, type ScheduleEntry } from './schedules.js';
import logger from '../../core/logger.js';

/**
 * Start the scheduler. Reads SCHEDULED_TASKS env var and starts cron jobs
 * for matching schedule entries. Auto-discovers extension schedules.
 */
export async function startScheduler(
  agents: Record<string, Agent<AppContext>>,
  context: AppContext,
  onStatus?: (event: { schedule: string; status: string; output?: string; message?: string }) => void,
) {
  const enabled = (process.env.SCHEDULED_TASKS || 'none').split(',').map(s => s.trim());
  if (enabled.includes('none')) return;

  // Merge extension schedules
  let extensionSchedules: ScheduleEntry[] = [];
  try {
    const mod = await import('../extensions/schedules.js');
    extensionSchedules = mod.default ?? [];
  } catch { /* no extension schedules */ }

  const allSchedules = [...schedules, ...extensionSchedules];
  const active = allSchedules.filter(s => enabled.includes(s.name));

  if (active.length === 0) {
    logger.info('[scheduler] No matching schedules found');
    return;
  }

  // Dynamic import — node-cron is optional
  const cron = await import('node-cron');

  for (const schedule of active) {
    const agent = agents[schedule.agent];
    if (!agent) {
      logger.warn(`[scheduler] Unknown agent "${schedule.agent}" for schedule "${schedule.name}"`);
      continue;
    }

    cron.schedule(schedule.cron, async () => {
      logger.info(`[scheduler] Running: ${schedule.name}`);
      try {
        const result = await run(agent, schedule.prompt, { context });
        onStatus?.({ schedule: schedule.name, status: 'completed', output: result.finalOutput as string });
      } catch (err) {
        logger.error(`[scheduler] ${schedule.name} failed: ${err}`);
        onStatus?.({ schedule: schedule.name, status: 'error', message: String(err) });
      }
    });

    logger.info(`[scheduler] Scheduled: ${schedule.name} (${schedule.cron}) → ${schedule.agent}`);
  }
}
