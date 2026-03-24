import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname', singleLine: true },
    },
  }),
});

export function logOrchestratorError(sessionId: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  logger.error({ sid: sessionId, error: msg }, `[orchestrator] ${msg}`);
}

export default logger;
