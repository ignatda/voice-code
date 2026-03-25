import { Router, json } from 'express';
import { validateEnv, writeEnv, getSettingsSnapshot, bootstrapPrimaryProvider } from '../core/config.js';
import { reinitProvider } from '../agents/provider.js';
import logger from '../core/logger.js';

const router = Router();
router.use(json());

// Simple auth: require X-Settings-Token header matching env var (if set)
router.use((req, res, next) => {
  const token = process.env.SETTINGS_TOKEN;
  if (token && req.headers['x-settings-token'] !== token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

router.get('/', (_req, res) => {
  const settings = getSettingsSnapshot();
  const validation = validateEnv();
  res.json({ settings, validation });
});

router.post('/', (req, res) => {
  const updates = req.body as Record<string, string>;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    res.status(400).json({ error: 'Body must be a JSON object of key-value pairs' });
    return;
  }

  // Only allow known safe keys to be written
  const allowed = new Set(['LLM_PROVIDERS', 'XAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'STT_PROVIDER', 'TTS_PROVIDER', 'PORT', 'CODING_CLI', 'IDE_TYPE', 'EXTENSIONS', 'SCHEDULED_TASKS', 'ORCHESTRATOR_TYPE']);
  const invalid = Object.keys(updates).filter(k => !allowed.has(k));
  if (invalid.length) {
    res.status(400).json({ error: `Disallowed keys: ${invalid.join(', ')}` });
    return;
  }

  writeEnv(updates);
  const masked = Object.fromEntries(Object.entries(updates).map(([k, v]) =>
    [k, k.includes('KEY') ? '••••' + v.slice(-4) : v]
  ));
  logger.info({ settings: masked }, '[settings] Updated by user');
  bootstrapPrimaryProvider();
  reinitProvider();
  const validation = validateEnv();
  res.json({ ok: true, validation });
});

export default router;
