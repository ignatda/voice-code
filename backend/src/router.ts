import path from 'path';
import { fileURLToPath } from 'url';
import { run } from '@openai/agents';
import type { Server } from 'socket.io';
import logger from './core/logger.js';
import { getXAIConfig } from './core/config.js';
import { SessionStore } from './core/session.js';
import { createSignal, abortAll, cleanup, isStopCommand } from './core/interrupt.js';
import { XAIVoiceClient } from './agents/voice/index.js';
import { buildAgentGraph, killTerminalProcess, isPlannerExit } from './agents/index.js';
import type { AppContext } from './agents/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const XAI_API_KEY = process.env.OPENAI_API_KEY || process.env.XAI_API_KEY;

const socketSession = new Map<string, string>();
const statusMap = new Map<string, string>();
const readOnlyMap = new Map<string, boolean>();
const xaiClients = new Map<string, XAIVoiceClient>();
const pendingPlans = new Map<string, string>();
const plannerMode = new Map<string, boolean>();

const STOP_SCRIPT = path.resolve(__dirname, 'agents', 'ide', 'tools', 'stop.sh');

function killAll(sid: string): void {
  abortAll(sid);
  killTerminalProcess();
  import('child_process').then(({ execFile }) => {
    execFile(STOP_SCRIPT, (err) => {
      if (err) logger.error({ sid }, `[stop] stop.sh error: ${err.message}`);
      else logger.info({ sid }, '[stop] stop.sh executed');
    });
  });
}

function getActiveSessionId(socketId: string): string | undefined {
  return socketSession.get(socketId);
}

function ensureSession(sid: string, socket: any): string {
  if (!socketSession.has(sid)) {
    const { id, name, items } = SessionStore.create();
    socketSession.set(sid, id);
    socket.emit('session_list', SessionStore.list());
    socket.emit('session_switched', { id, name, items });
  }
  return socketSession.get(sid)!;
}

async function processWithOrchestrator(transcription: string, sid: string, io: Server): Promise<void> {
  const sessionId = getActiveSessionId(sid);

  if (isStopCommand(transcription)) {
    logger.info({ sid }, '[interrupt] Stop command detected');
    killAll(sid);
    io.to(sid).emit('agents_stopped', { message: 'All agents stopped.' });
    if (sessionId) {
      new SessionStore(sessionId).addDisplayItem({ type: 'system', text: '⛔ All agents stopped.' });
      plannerMode.delete(sessionId);
    }
    return;
  }

  const isReadOnly = readOnlyMap.get(sid) ?? false;
  const pendingPlan = sessionId ? pendingPlans.get(sessionId) : undefined;
  const inPlannerMode = sessionId ? (plannerMode.get(sessionId) ?? false) : false;
  logger.info({ sid }, `[orchestrator] Processing, text_len=${transcription.length}, readOnly=${isReadOnly}, plannerMode=${inPlannerMode}`);

  const graph = await buildAgentGraph({
    readOnly: isReadOnly,
    plannerMode: inPlannerMode,
    pendingPlan,
  });

  const signal = createSignal(sid);
  const agentSessionId = sessionId || sid;
  const session = new SessionStore(agentSessionId);
  const context: AppContext = {
    config: getXAIConfig(),
    logger,
    readOnly: isReadOnly,
    sessionId: agentSessionId,
  };

  // Record user message
  if (sessionId) {
    session.addDisplayItem({ type: 'user', text: transcription });
    io.to(sid).emit('session_list', SessionStore.list());
  }

  io.to(sid).emit('transcription_result', { original_text: transcription, prompts: [] });

  try {
    const result = await run(graph.orchestrator, transcription, {
      signal,
      session,
      context,
      maxTurns: 30,
    });

    const output = result.finalOutput || '';
    const lastAgentName = result.lastAgent?.name || 'Orchestrator';

    logger.info({ sid }, `[run] Completed. lastAgent=${lastAgentName}, output_len=${output.length}`);

    if (isPlannerExit(output) && sessionId) {
      plannerMode.delete(sessionId);
      io.to(sid).emit('ide_result', { agent: 'planner', status: 'success', message: 'Exited planning mode.', received_prompt: transcription });
      session.addDisplayItem({ type: 'system', text: 'Exited planning mode.' });
      return;
    }

    if (lastAgentName === 'Browser Agent') {
      io.to(sid).emit('browser_result', { status: 'success', message: output });
      if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'browser', text: output });
    } else if (lastAgentName === 'Planner Agent') {
      if (sessionId) {
        plannerMode.set(sessionId, true);
        pendingPlans.set(sessionId, output);
      }
      io.to(sid).emit('ide_result', { agent: 'planner', status: 'success', message: output, received_prompt: transcription });
      if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'planner', text: output });
    } else if (lastAgentName === 'IDE Agent') {
      if (sessionId) {
        pendingPlans.delete(sessionId);
        plannerMode.delete(sessionId);
      }
      io.to(sid).emit('ide_result', { agent: 'ide', status: 'success', message: output, received_prompt: transcription });
      if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'jetbrains', text: output });
    } else {
      io.to(sid).emit('ide_result', { agent: 'orchestrator', status: 'success', message: output, received_prompt: transcription });
      if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'orchestrator', text: output });
    }
  } catch (error) {
    if (signal.aborted) {
      logger.info({ sid }, '[run] Interrupted by user');
      io.to(sid).emit('agents_stopped', { message: 'Interrupted by user.' });
      return;
    }
    logger.error({ sid }, `[run] Error: ${error}`);
    io.to(sid).emit('ide_result', { agent: 'ide', status: 'error', message: String(error), received_prompt: transcription });
    if (sessionId) session.addDisplayItem({ type: 'system', text: `Error: ${error}` });
  }
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    const sid = socket.id;
    logger.info({ sid }, '[socketio] Client connected');

    socket.on('set_read_only', (value: boolean) => {
      readOnlyMap.set(sid, value);
      logger.info({ sid }, `[socketio] Read-only mode set to ${value}`);
    });

    socket.on('get_sessions', () => {
      socket.emit('session_list', SessionStore.list());
    });

    socket.on('create_session', () => {
      const { id, name, items } = SessionStore.create();
      socketSession.set(sid, id);
      socket.emit('session_list', SessionStore.list());
      socket.emit('session_switched', { id, name, items, inputHistory: [] });
    });

    socket.on('switch_session', (sessionId: string) => {
      if (!SessionStore.exists(sessionId)) return;
      socketSession.set(sid, sessionId);
      const store = new SessionStore(sessionId);
      socket.emit('session_switched', { id: sessionId, name: store.getName(), items: store.getDisplayItems(), inputHistory: store.getInputHistory() });
    });

    socket.on('delete_session', (sessionId: string) => {
      SessionStore.delete(sessionId);
      pendingPlans.delete(sessionId);
      plannerMode.delete(sessionId);
      if (socketSession.get(sid) === sessionId) {
        socketSession.delete(sid);
      }
      socket.emit('session_list', SessionStore.list());
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

      ensureSession(sid, socket);
      statusMap.set(sid, 'idle');

      const xaiClient = new XAIVoiceClient(XAI_API_KEY, sid);
      xaiClient.setCallbacks(
        (transcript: string) => {
          io.to(sid).emit('transcription_update', { type: 'transcript', text: transcript });
          statusMap.set(sid, 'executing');
          socket.emit('status', { status: 'executing' });
          processWithOrchestrator(transcript, sid, io);
        },
        (status: string) => { io.to(sid).emit('status', { status }); },
        (error: string) => {
          logger.info({ sid }, `[x.ai] Error: ${error}`);
          io.to(sid).emit('error', { message: error });
        },
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
      xaiClients.get(sid)?.sendAudio(buffer.toString('base64'));
      const currentStatus = statusMap.get(sid);
      if (currentStatus === 'idle' || currentStatus === undefined) {
        statusMap.set(sid, 'listening');
        socket.emit('status', { status: 'listening' });
      }
    });

    socket.on('commit_audio', () => {
      logger.info({ sid }, '[socketio] commit_audio received');
      xaiClients.get(sid)?.commitAudio();
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
      ensureSession(sid, socket);
      const sessionId = getActiveSessionId(sid);
      if (sessionId) new SessionStore(sessionId).addInputHistory(text.trim());
      statusMap.set(sid, 'executing');
      socket.emit('status', { status: 'executing' });
      processWithOrchestrator(text.trim(), sid, io);
    });

    socket.on('stop_all', () => {
      logger.info({ sid }, '[socketio] stop_all received');
      killAll(sid);
      socket.emit('agents_stopped', { message: 'All agents stopped.' });
    });

    socket.on('disconnect', () => {
      logger.info({ sid }, '[socketio] Client disconnected');
      abortAll(sid);
      cleanup(sid);
      socketSession.delete(sid);
      const xaiClient = xaiClients.get(sid);
      if (xaiClient) {
        xaiClient.close();
        xaiClients.delete(sid);
      }
      statusMap.delete(sid);
      readOnlyMap.delete(sid);
    });
  });
}
