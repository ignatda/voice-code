import { Router, json } from 'express';
import { validateEnv, writeEnv, getSettingsSnapshot } from '../core/config.js';

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
  const allowed = new Set(['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'PORT', 'CODING_CLI', 'IDE_TYPE', 'EXTENSIONS', 'SCHEDULED_TASKS']);
  const invalid = Object.keys(updates).filter(k => !allowed.has(k));
  if (invalid.length) {
    res.status(400).json({ error: `Disallowed keys: ${invalid.join(', ')}` });
    return;
  }

  writeEnv(updates);
  const validation = validateEnv();
  res.json({ ok: true, validation });
});

export default router;
