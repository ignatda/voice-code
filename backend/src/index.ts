// Load .env BEFORE agent imports (agents SDK sets up tracing at import time)
import { loadEnv, bootstrapPrimaryProvider } from './core/config.js';
loadEnv();
bootstrapPrimaryProvider();

const { default: logger } = await import('./core/logger.js');
logger.info('Loading .env via config/env');

const { httpServer, io } = await import('./server.js');
const { registerSocketHandlers } = await import('./router.js');

const PORT = parseInt(process.env.PORT || '5000');

registerSocketHandlers(io);

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
