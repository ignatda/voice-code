// ── Declarative schedule definitions ─────────────────────────────────────────

export interface ScheduleEntry {
  name: string;
  cron: string;
  agent: string;
  prompt: string;
}

// Community schedules — add entries here.
// Enable via SCHEDULED_TASKS env var (comma-separated names).
export const schedules: ScheduleEntry[] = [
  { name: 'example-health-check', cron: '0 */6 * * *', agent: 'browser', prompt: 'Check if http://localhost:5173 is responding and report status' },
];
