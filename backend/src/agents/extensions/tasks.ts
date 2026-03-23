import type { TaskFn } from '../tasks/registry.js';

// Extension background tasks — add your custom tasks here.
// These are merged into the task registry at startup.
const extensionTasks: Record<string, TaskFn> = {
  // 'deploy-staging': async ({ branch }) => { ... },
};

export default extensionTasks;
