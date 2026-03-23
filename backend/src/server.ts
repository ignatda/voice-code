import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { validateEnv } from './core/config.js';
import settingsRouter from './routes/settings.js';

const app = express();
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});
app.use('/api/settings', settingsRouter);
app.get('/api/settings/setup-required', (_req, res) => {
  res.json({ setupRequired: !validateEnv().valid });
});

export const httpServer = createServer(app);
export const io = new Server(httpServer, { cors: { origin: '*' } });
