import { initPool } from '../core/providers.js';

let initialized = false;

export function ensureProvider(): void {
  if (initialized) return;
  initPool();
  initialized = true;
}

export function reinitProvider(): void {
  initPool();
  initialized = true;
}
