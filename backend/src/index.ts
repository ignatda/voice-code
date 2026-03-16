import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env BEFORE agent imports (agents SDK sets up tracing at import time)
const envPath = path.resolve(__dirname, '..', '.env');
const { default: logger } = await import('./log.js');
logger.info({ envPath }, 'Loading .env');
dotenv.config({ path: envPath, override: true });

// Dynamic imports so env vars are available when agent modules load
const { XAIVoiceClient } = await import('./xai-realtime.js');
const { OrchestratorAgent, BrowserAgent, JetBrainsAgent, PlannerAgent } = await import('./agents/index.js');
const { createSignal, abortAll, cleanup, isStopCommand } = await import('./interrupt.js');

const XAI_API_KEY = process.env.OPENAI_API_KEY || process.env.XAI_API_KEY;
const PORT = parseInt(process.env.PORT || '5000');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

// ── Session store ─────────────────────────────────────────────────────────────
interface ConversationItem {
  type: 'user' | 'agent' | 'system';
  text: string;
  agent?: string;
}

interface Session {
  id: string;
  name: string;
  items: ConversationItem[];
  createdAt: number;
}

const SESSIONS_DIR = path.resolve(__dirname, '..', 'sessions');

// ── File-backed session persistence ───────────────────────────────────────────
import fs from 'fs';

function ensureSessionsDir() {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sessionPath(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.md`);
}

function serializeSession(session: Session): string {
  const lines = [
    `<!-- id: ${session.id} -->`,
    `<!-- created: ${session.createdAt} -->`,
    `# ${session.name}`,
    '',
  ];
  for (const item of session.items) {
    const prefix = item.type === 'user' ? '**user**' : item.type === 'system' ? '**system**' : `**${item.agent || 'agent'}**`;
    lines.push(`${prefix}: ${item.text}`, '');
  }
  return lines.join('\n');
}

function parseSession(content: string, id: string): Session {
  const createdMatch = content.match(/<!-- created: (\d+) -->/);
  const nameMatch = content.match(/^# (.+)$/m);
  const createdAt = createdMatch ? parseInt(createdMatch[1]) : Date.now();
  const name = nameMatch ? nameMatch[1] : 'New session';

  const items: ConversationItem[] = [];
  const itemRegex = /^\*\*(\w+)\*\*: (.+)$/gm;
  let m;
  while ((m = itemRegex.exec(content)) !== null) {
    const label = m[1];
    const text = m[2];
    if (label === 'user') items.push({ type: 'user', text });
    else if (label === 'system') items.push({ type: 'system', text });
    else items.push({ type: 'agent', agent: label, text });
  }
  return { id, name, items, createdAt };
}

function saveSession(session: Session) {
  ensureSessionsDir();
  fs.writeFileSync(sessionPath(session.id), serializeSession(session), 'utf-8');
}

function loadAllSessions(): Map<string, Session> {
  ensureSessionsDir();
  const map = new Map<string, Session>();
  for (const file of fs.readdirSync(SESSIONS_DIR)) {
    if (!file.endsWith('.md')) continue;
    const id = file.replace('.md', '');
    try {
      const content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8');
      map.set(id, parseSession(content, id));
    } catch { /* skip corrupt files */ }
  }
  return map;
}

function deleteSessionFile(id: string) {
  try { fs.unlinkSync(sessionPath(id)); } catch { /* ignore */ }
}

const sessions = loadAllSessions();
const socketSession = new Map<string, string>();

function createSession(): Session {
  const id = crypto.randomUUID();
  const session: Session = { id, name: 'New session', items: [], createdAt: Date.now() };
  sessions.set(id, session);
  saveSession(session);
  return session;
}

function getSessionName(session: Session): string {
  const firstText = session.items.find(i => i.type === 'user')?.text;
  if (!firstText) return 'New session';
  return firstText.length > 20 ? firstText.slice(0, 20) + '...' : firstText;
}

function getSessionList() {
  return [...sessions.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(s => ({ id: s.id, name: s.name }));
}

function addItem(sessionId: string, item: ConversationItem) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.items.push(item);
  if (session.name === 'New session' && item.type === 'user') {
    session.name = getSessionName(session);
  }
  saveSession(session);
}

// ── Per-socket state ──────────────────────────────────────────────────────────
const statusMap = new Map<string, string>();
const readOnlyMap = new Map<string, boolean>();
const xaiClients = new Map<string, InstanceType<typeof XAIVoiceClient>>();

const orchestratorAgent = new OrchestratorAgent(XAI_API_KEY || '');
const browserAgent = new BrowserAgent();
const jetbrainsAgent = new JetBrainsAgent();
const plannerAgent = new PlannerAgent(XAI_API_KEY || '');
const pendingPlans = new Map<string, string>(); // sessionId → plan markdown

function getActiveSessionId(socketId: string): string | undefined {
  return socketSession.get(socketId);
}

async function processWithOrchestrator(transcription: string, sid: string): Promise<void> {
  const sessionId = getActiveSessionId(sid);

  if (isStopCommand(transcription)) {
    logger.info({ sid }, '[interrupt] Stop command detected');
    abortAll(sid);
    jetbrainsAgent.killTerminalProcess();
    io.to(sid).emit('agents_stopped', { message: 'All agents stopped.' });
    if (sessionId) addItem(sessionId, { type: 'system', text: '⛔ All agents stopped.' });
    return;
  }

  const isReadOnly = readOnlyMap.get(sid) ?? false;
  const pendingPlan = sessionId ? pendingPlans.get(sessionId) : undefined;
  logger.info({ sid }, `[orchestrator] Processing transcription, text_len=${transcription.length}, readOnly=${isReadOnly}, hasPlan=${!!pendingPlan}`);

  const result = await orchestratorAgent.process(transcription, isReadOnly, sessionId || sid, pendingPlan);

  logger.info({ sid }, `[orchestrator] Generated ${result.prompts.length} prompts`);
  io.to(sid).emit('transcription_result', result);

  if (sessionId) {
    if (result.original_text) {
      addItem(sessionId, { type: 'user', text: result.original_text });
    }
    for (const p of result.prompts) {
      addItem(sessionId, { type: 'agent', agent: 'orchestrator', text: p.prompt });
    }
    io.to(sid).emit('session_list', getSessionList());
  }

  for (const promptInfo of result.prompts) {
    const signal = createSignal(sid);
    if (promptInfo.agent === 'browser') {
      runBrowserCommand(promptInfo.prompt, sid, signal, isReadOnly);
    } else if (promptInfo.agent === 'planner') {
      plannerAgent.process(promptInfo.prompt, sessionId || sid, signal).then((r) => {
        io.to(sid).emit('ide_result', r);
        if (sessionId) {
          addItem(sessionId, { type: 'agent', agent: 'planner', text: r.message });
          pendingPlans.set(sessionId, r.message);
        }
      }).catch((error) => {
        logger.info({ sid }, `[planner_agent] Error: ${error}`);
        const msg = String(error);
        io.to(sid).emit('ide_result', { agent: 'planner', status: 'error', message: msg, received_prompt: promptInfo.prompt });
        if (sessionId) addItem(sessionId, { type: 'agent', agent: 'planner', text: msg });
      });
    } else if (promptInfo.agent === 'jetbrains') {
      // Clear pending plan once it's sent to jetbrains for implementation
      if (sessionId && pendingPlans.has(sessionId)) pendingPlans.delete(sessionId);
      jetbrainsAgent.process(promptInfo.prompt, signal, isReadOnly).then((r) => {
        io.to(sid).emit('ide_result', r);
        if (sessionId) addItem(sessionId, { type: 'agent', agent: 'jetbrains', text: r.message });
      }).catch((error) => {
        logger.info({ sid }, `[jetbrains_agent] Error: ${error}`);
        const msg = String(error);
        io.to(sid).emit('ide_result', { agent: 'jetbrains', status: 'error', message: msg, received_prompt: promptInfo.prompt });
        if (sessionId) addItem(sessionId, { type: 'agent', agent: 'jetbrains', text: msg });
      });
    }
  }
}

function runBrowserCommand(prompt: string, sid: string, signal?: AbortSignal, readOnly?: boolean): void {
  const sessionId = getActiveSessionId(sid);
  logger.info({ sid }, `[browser_agent] Processing command: ${prompt}`);
  browserAgent
    .process(prompt, signal, readOnly)
    .then((result) => {
      io.to(sid).emit('browser_result', result);
      if (sessionId) addItem(sessionId, { type: 'agent', agent: 'browser', text: result.message || result.error || 'No response' });
    })
    .catch((error) => {
      logger.info({ sid }, `[browser_agent] Error: ${error}`);
      io.to(sid).emit('browser_result', { status: 'error', error: String(error) });
      if (sessionId) addItem(sessionId, { type: 'agent', agent: 'browser', text: String(error) });
    });
}

io.on('connection', (socket) => {
  const sid = socket.id;
  logger.info({ sid }, '[socketio] Client connected');

  socket.on('set_read_only', (value: boolean) => {
    readOnlyMap.set(sid, value);
    logger.info({ sid }, `[socketio] Read-only mode set to ${value}`);
  });

  // ── Session management ────────────────────────────────────────────────────
  socket.on('get_sessions', () => {
    socket.emit('session_list', getSessionList());
  });

  socket.on('create_session', () => {
    const session = createSession();
    socketSession.set(sid, session.id);
    orchestratorAgent.clearHistory(session.id);
    socket.emit('session_list', getSessionList());
    socket.emit('session_switched', { id: session.id, name: session.name, items: session.items });
  });

  socket.on('switch_session', (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    socketSession.set(sid, session.id);
    socket.emit('session_switched', { id: session.id, name: session.name, items: session.items });
  });

  socket.on('delete_session', (sessionId: string) => {
    sessions.delete(sessionId);
    deleteSessionFile(sessionId);
    orchestratorAgent.clearHistory(sessionId);
    plannerAgent.clearHistory(sessionId);
    pendingPlans.delete(sessionId);
    if (socketSession.get(sid) === sessionId) {
      socketSession.delete(sid);
    }
    socket.emit('session_list', getSessionList());
    socket.emit('session_deleted', sessionId);
  });

  socket.on('start_transcription_stream', async () => {
    if (!XAI_API_KEY) {
      socket.emit('error', { message: 'OPENAI_API_KEY not configured on server.' });
      return;
    }

    if (xaiClients.has(sid)) {
      socket.emit('error', { message: 'Transcription stream already active.' });
      return;
    }

    // Auto-create session if none active
    if (!socketSession.has(sid)) {
      const session = createSession();
      socketSession.set(sid, session.id);
      socket.emit('session_list', getSessionList());
      socket.emit('session_switched', { id: session.id, name: session.name, items: session.items });
    }

    statusMap.set(sid, 'idle');

    const xaiClient = new XAIVoiceClient(XAI_API_KEY, sid);

    xaiClient.setCallbacks(
      (transcript: string) => {
        io.to(sid).emit('transcription_update', { type: 'transcript', text: transcript });
        statusMap.set(sid, 'executing');
        socket.emit('status', { status: 'executing' });
        processWithOrchestrator(transcript, sid);
      },
      (status: string) => {
        io.to(sid).emit('status', { status });
      },
      (error: string) => {
        logger.info({ sid }, `[x.ai] Error: ${error}`);
        io.to(sid).emit('error', { message: error });
      }
    );

    try {
      await xaiClient.connect();
      xaiClients.set(sid, xaiClient);
      socket.emit('transcription_started', { message: 'Connected to x.ai and ready for audio.' });
      socket.emit('status', { status: 'idle' });
      logger.info({ sid }, '[socketio] Transcription stream started');
    } catch (error) {
      logger.info({ sid }, `[x.ai] Failed to connect: ${error}`);
      socket.emit('error', { message: `Failed to connect to x.ai: ${error}` });
      xaiClients.delete(sid);
    }
  });

  socket.on('audio_chunk', (data: unknown) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    const xaiClient = xaiClients.get(sid);

    if (xaiClient) {
      const audioBase64 = buffer.toString('base64');
      xaiClient.sendAudio(audioBase64);
    }

    const currentStatus = statusMap.get(sid);
    if (currentStatus === 'idle' || currentStatus === undefined) {
      statusMap.set(sid, 'listening');
      socket.emit('status', { status: 'listening' });
    }
  });

  socket.on('commit_audio', () => {
    logger.info({ sid }, '[socketio] commit_audio received');
    const xaiClient = xaiClients.get(sid);
    if (xaiClient) {
      xaiClient.commitAudio();
    }
  });

  socket.on('stop_transcription_stream', async () => {
    logger.info({ sid }, '[socketio] stop_transcription_stream');
    const xaiClient = xaiClients.get(sid);
    if (xaiClient) {
      xaiClient.close();
      xaiClients.delete(sid);
      socket.emit('transcription_stopped', { message: 'Transcription stream stopped.' });
    } else {
      socket.emit('error', { message: 'No active transcription stream to stop.' });
    }
    statusMap.delete(sid);
  });

  socket.on('manual_prompt', (text: string) => {
    if (!text?.trim()) return;
    logger.info({ sid }, `[socketio] Manual prompt received, len=${text.length}`);

    // Auto-create session if none active
    if (!socketSession.has(sid)) {
      const session = createSession();
      socketSession.set(sid, session.id);
      socket.emit('session_list', getSessionList());
      socket.emit('session_switched', { id: session.id, name: session.name, items: session.items });
    }

    statusMap.set(sid, 'executing');
    socket.emit('status', { status: 'executing' });
    processWithOrchestrator(text.trim(), sid);
  });

  socket.on('stop_all', () => {
    logger.info({ sid }, '[socketio] stop_all received');
    abortAll(sid);
    jetbrainsAgent.killTerminalProcess();
    socket.emit('agents_stopped', { message: 'All agents stopped.' });
  });

  socket.on('disconnect', () => {
    logger.info({ sid }, '[socketio] Client disconnected');
    abortAll(sid);
    cleanup(sid);
    socketSession.delete(sid);
    const xaiClient = xaiClients.get(sid);
    if (xaiClient) {
      logger.info({ sid }, '[x.ai] Closing connection due to client disconnect');
      xaiClient.close();
      xaiClients.delete(sid);
    }
    statusMap.delete(sid);
    readOnlyMap.delete(sid);
  });
});

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
