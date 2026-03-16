/**
 * Global interrupt registry — tracks AbortControllers per session.
 * When "stop" is detected, all controllers for that session are aborted.
 */

import logger from './log.js';

const sessionControllers = new Map<string, Set<AbortController>>();

export function createSignal(sid: string): AbortSignal {
  const controller = new AbortController();
  if (!sessionControllers.has(sid)) {
    sessionControllers.set(sid, new Set());
  }
  sessionControllers.get(sid)!.add(controller);

  // Auto-cleanup when aborted
  controller.signal.addEventListener('abort', () => {
    sessionControllers.get(sid)?.delete(controller);
  });

  return controller.signal;
}

export function abortAll(sid: string): void {
  const controllers = sessionControllers.get(sid);
  if (!controllers) return;
  logger.info({ sid }, `[interrupt] Aborting ${controllers.size} running task(s)`);
  for (const c of controllers) {
    c.abort();
  }
  controllers.clear();
}

export function cleanup(sid: string): void {
  sessionControllers.delete(sid);
}

export function isStopCommand(text: string): boolean {
  return /^\s*stop\s*[.!]?\s*$/i.test(text);
}
