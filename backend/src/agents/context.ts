import type { Logger } from 'pino';

/** Shared context passed to SDK run() via the `context` option. */
export interface AppContext {
  config: { apiKey: string; baseURL: string; model: string };
  logger: Logger;
  readOnly: boolean;
  sessionId: string;
}
