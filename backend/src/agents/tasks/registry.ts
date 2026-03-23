// ── Declarative task registry ────────────────────────────────────────────────

export type TaskFn = (params: Record<string, string>) => Promise<string>;

const taskRegistry = new Map<string, TaskFn>();

// Community example task (always available)
taskRegistry.set('example-echo', async ({ message }) => `Echo: ${message ?? 'no message'}`);

// Auto-discover extension tasks
try {
  const mod = await import('../extensions/tasks.js');
  for (const [name, fn] of Object.entries(mod.default ?? {})) {
    taskRegistry.set(name, fn as TaskFn);
  }
} catch { /* no extension tasks */ }

export { taskRegistry };
