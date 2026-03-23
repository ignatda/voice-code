import type { ScheduleEntry } from '../tasks/schedules.js';

// Extension scheduled tasks — add your custom schedules here.
// These are merged with community schedules at startup.
// Enable via SCHEDULED_TASKS env var (comma-separated names).
const extensionSchedules: ScheduleEntry[] = [
  // { name: 'nightly-deploy-check', cron: '0 2 * * *', agent: 'deploy-agent', prompt: 'Verify all staging deployments are healthy' },
];

export default extensionSchedules;
