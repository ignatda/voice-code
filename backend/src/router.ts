import path from 'path';
import { fileURLToPath } from 'url';
import { Runner } from '@openai/agents';
import type { Server } from 'socket.io';
import logger, { logOrchestratorError } from './core/logger.js';
import { getXAIConfig } from './core/config.js';
import { resetRotation, rotateProvider, getCurrentModel, getCurrentProviderName } from './core/providers.js';
import { SessionStore } from './core/session.js';
import { createSignal, abortAll, cleanup, isStopCommand } from './core/interrupt.js';
import { createVoiceClient, createTTSClient, type VoiceTransport, type TTSTransport } from './agents/voice/index.js';
import { buildAgentGraph, killTerminalProcess, isPlannerExit } from './agents/index.js';
import type { AppContext } from './agents/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function formatError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as any;
  const parts: string[] = [];
  if (e.status) parts.push(`${e.status}`);
  if (e.error?.message) parts.push(e.error.message);
  else if (e.message) parts.push(e.message);
  if (e.error?.status) parts.push(`(${e.error.status})`);
  return parts.join(' ') || String(err);
}

/** Log context with sid + current provider */
const ctx = (sid: string) => ({ sid, provider: getCurrentProviderName() });

const getXaiApiKey = () => process.env.XAI_API_KEY;
const getSttApiKey = () => {
  const provider = process.env.STT_PROVIDER || 'xai';
  if (provider === 'groq') return process.env.GROQ_API_KEY;
  if (provider === 'gemini') return process.env.GEMINI_API_KEY;
  return process.env.XAI_API_KEY;
};

const getTtsApiKey = () => {
  const provider = process.env.TTS_PROVIDER || process.env.STT_PROVIDER || 'xai';
  if (provider === 'groq') return process.env.GROQ_API_KEY;
  if (provider === 'gemini') return process.env.GEMINI_API_KEY;
  return process.env.XAI_API_KEY;
};

const socketSession = new Map<string, string>();
const statusMap = new Map<string, string>();
const readOnlyMap = new Map<string, boolean>();
const voiceClients = new Map<string, VoiceTransport>();
const ttsClients = new Map<string, TTSTransport>();
const ttsEnabled = new Map<string, boolean>();
const pendingPlans = new Map<string, string>();
const plannerMode = new Map<string, boolean>();

const STOP_SCRIPT = path.resolve(__dirname, 'agents', 'ide', 'tools', 'stop.sh');

function killAll(sid: string): void {
  abortAll(sid);
  killTerminalProcess();
  const tts = ttsClients.get(sid);
  if (tts) { tts.close(); ttsClients.delete(sid); }
  import('child_process').then(({ execFile }) => {
    execFile(STOP_SCRIPT, (err) => {
      if (err) logger.error(ctx(sid), `[stop] stop.sh error: ${err.message}`);
      else logger.info(ctx(sid), '[stop] stop.sh executed');
    });
  });
}

async function speakIfEnabled(sid: string, text: string, io: Server): Promise<void> {
  if (!ttsEnabled.get(sid)) return;
  const maxLen = parseInt(process.env.TTS_MAX_LENGTH || '500', 10);
  if (text.length > maxLen) return;
  const tts = ttsClients.get(sid);
  if (!tts) return;
  await tts.synthesize(text);
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
    logger.info(ctx(sid), '[interrupt] Stop command detected');
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
  logger.info(ctx(sid), `[orchestrator] Processing, text_len=${transcription.length}, readOnly=${isReadOnly}, plannerMode=${inPlannerMode}`);

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

  const isRetryable = (err: unknown): boolean => {
    if (err && typeof err === 'object') {
      const e = err as any;
      const status = e.status ?? e.code;
      if ([400, 404, 429, 500, 502, 503].includes(status)) return true;
      if (typeof e.message === 'string' && (e.message.includes('429') || e.message.toLowerCase().includes('rate limit') || e.message.toLowerCase().includes('model not found'))) return true;
    }
    return false;
  };

  try {
    resetRotation();
    let graph = await buildAgentGraph({
      readOnly: isReadOnly,
      plannerMode: inPlannerMode,
      pendingPlan,
    });
    logger.info(ctx(sid), `[run] Starting with model=${getCurrentModel()}`);

    let result;
    let retries = 0;
    while (true) {
      try {
        result = await new Runner().run(graph.orchestrator, transcription, {
          signal,
          session,
          context,
          maxTurns: 30,
        });
        break;
      } catch (error) {
        if (isRetryable(error)) {
          const failedProvider = getCurrentProviderName();
          if (rotateProvider()) {
            logger.warn({ sid, provider: failedProvider }, `[run] ${formatError(error)}, rotating to ${getCurrentProviderName()}`);
            io.to(sid).emit('provider_rotated', { provider: getCurrentProviderName(), reason: String((error as any).status || 'error') });
            graph = await buildAgentGraph({ readOnly: isReadOnly, plannerMode: inPlannerMode, pendingPlan });
            continue;
          }
          if (retries < 2) {
            retries++;
            logger.warn({ sid, provider: failedProvider }, `[run] ${formatError(error)}, retrying same provider`);
            resetRotation();
            graph = await buildAgentGraph({ readOnly: isReadOnly, plannerMode: inPlannerMode, pendingPlan });
            continue;
          }
        }
        throw error;
      }
    }

    const output = result.finalOutput || '';
    const lastAgentName = result.lastAgent?.name || 'Orchestrator';

    if (!output && lastAgentName === 'Orchestrator') {
      const fallback = 'Sorry, I couldn\'t process that request. Could you try rephrasing?';
      io.to(sid).emit('ide_result', { agent: 'orchestrator', status: 'success', message: fallback, received_prompt: transcription });
      if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'orchestrator', text: fallback });
      await speakIfEnabled(sid, fallback, io);
      return;
    }

    // Extract orchestrator narration when a handoff occurred
    let orchestratorNarration = '';
    if (lastAgentName !== 'Orchestrator') {
      for (const item of result.newItems || []) {
        if (item.type === 'message_output_item' && item.agent?.name === 'Orchestrator') {
          const content = (item as any).rawItem?.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === 'output_text' && c.text) orchestratorNarration = c.text;
            }
          }
        }
      }
    }

    logger.info(ctx(sid), `[run] Completed. lastAgent=${lastAgentName}, output_len=${output.length}, output_preview=${JSON.stringify(output.slice(0, 200))}`);

    if (isPlannerExit(output) && sessionId) {
      plannerMode.delete(sessionId);
      io.to(sid).emit('ide_result', { agent: 'planner', status: 'success', message: 'Exited planning mode.', received_prompt: transcription });
      session.addDisplayItem({ type: 'system', text: 'Exited planning mode.' });
      return;
    }

    if (lastAgentName === 'Browser Agent') {
      if (orchestratorNarration) {
        io.to(sid).emit('ide_result', { agent: 'orchestrator', status: 'success', message: orchestratorNarration });
        if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'orchestrator', text: orchestratorNarration });
        await speakIfEnabled(sid, orchestratorNarration, io);
      }
      io.to(sid).emit('browser_result', { status: 'success', message: output });
      if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'browser', text: output });
    } else if (lastAgentName === 'Planner Agent') {
      if (orchestratorNarration) {
        io.to(sid).emit('ide_result', { agent: 'orchestrator', status: 'success', message: orchestratorNarration });
        if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'orchestrator', text: orchestratorNarration });
        await speakIfEnabled(sid, orchestratorNarration, io);
      }
      if (sessionId) {
        plannerMode.set(sessionId, true);
        pendingPlans.set(sessionId, output);
      }
      io.to(sid).emit('ide_result', { agent: 'planner', status: 'success', message: output, received_prompt: transcription });
      if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'planner', text: output });
    } else if (lastAgentName === 'IDE Agent') {
      if (orchestratorNarration) {
        io.to(sid).emit('ide_result', { agent: 'orchestrator', status: 'success', message: orchestratorNarration });
        if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'orchestrator', text: orchestratorNarration });
        await speakIfEnabled(sid, orchestratorNarration, io);
      }
      if (sessionId) {
        pendingPlans.delete(sessionId);
        plannerMode.delete(sessionId);
      }
      io.to(sid).emit('ide_result', { agent: 'ide', status: 'success', message: output, received_prompt: transcription });
      if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'jetbrains', text: output });
    } else {
      io.to(sid).emit('ide_result', { agent: 'orchestrator', status: 'success', message: output, received_prompt: transcription });
      if (sessionId) session.addDisplayItem({ type: 'agent', agent: 'orchestrator', text: output });
      await speakIfEnabled(sid, output, io);
    }
  } catch (error) {
    if (signal.aborted) {
      logger.info(ctx(sid), '[run] Interrupted by user');
      io.to(sid).emit('agents_stopped', { message: 'Interrupted by user.' });
      return;
    }
    const errMsg = formatError(error);
    logOrchestratorError(sid, error);
    const userMessage = 'Something went wrong while processing your request. Please try again.';
    io.to(sid).emit('orchestrator_error', { message: userMessage, detail: errMsg });
    io.to(sid).emit('ide_result', { agent: 'orchestrator', status: 'error', message: userMessage, received_prompt: transcription });
    if (sessionId) {
      session.setLastError(errMsg);
      session.addDisplayItem({ type: 'system', text: `Error: ${errMsg}` });
    }
  }
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    const sid = socket.id;
    logger.info(ctx(sid), '[socketio] Client connected');

    socket.on('set_read_only', (value: boolean) => {
      readOnlyMap.set(sid, value);
      logger.info(ctx(sid), `[socketio] Read-only mode set to ${value}`);
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
      const apiKey = getSttApiKey();
      if (!apiKey) {
        socket.emit('error', { message: 'STT provider API key not configured on server.' });
        return;
      }
      if (voiceClients.has(sid)) {
        socket.emit('error', { message: 'Transcription stream already active.' });
        return;
      }

      ensureSession(sid, socket);
      statusMap.set(sid, 'idle');

      const sttProvider = process.env.STT_PROVIDER || 'xai';
      const voiceClient = createVoiceClient(sttProvider, apiKey, sid);
      voiceClient.setCallbacks(
        (transcript: string) => {
          io.to(sid).emit('transcription_update', { type: 'transcript', text: transcript });
          statusMap.set(sid, 'executing');
          socket.emit('status', { status: 'executing' });
          processWithOrchestrator(transcript, sid, io);
        },
        (status: string) => { io.to(sid).emit('status', { status }); },
        (error: string) => {
          logger.info(ctx(sid), `[voice] Error: ${error}`);
          io.to(sid).emit('error', { message: error });
        },
      );

      try {
        await voiceClient.connect();
        voiceClients.set(sid, voiceClient);

        // Create TTS client alongside STT
        const ttsProvider = process.env.TTS_PROVIDER || process.env.STT_PROVIDER || 'xai';
        const ttsApiKey = getTtsApiKey();
        if (ttsApiKey && ttsProvider !== 'none') {
          const ttsClient = createTTSClient(ttsProvider, ttsApiKey, sid);
          ttsClient.setCallbacks(
            (audio) => io.to(sid).emit('voice_response_delta', { audio }),
            () => io.to(sid).emit('voice_response_done', {}),
            (error) => logger.error(ctx(sid), `[tts] Error: ${error}`),
          );
          ttsClients.set(sid, ttsClient);
          ttsEnabled.set(sid, false);
          logger.info(ctx(sid), `[tts] Client created`);
        }

        socket.emit('transcription_started', { message: 'Connected to STT provider and ready for audio.' });
        socket.emit('status', { status: 'idle' });
        logger.info(ctx(sid), '[socketio] Transcription stream started');
      } catch (error) {
        logger.info(ctx(sid), `[voice] Failed to connect: ${error}`);
        socket.emit('error', { message: `Failed to connect to STT provider: ${error}` });
        voiceClients.delete(sid);
      }
    });

    socket.on('audio_chunk', (data: unknown) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      voiceClients.get(sid)?.sendAudio(buffer.toString('base64'));
      const currentStatus = statusMap.get(sid);
      if (currentStatus === 'idle' || currentStatus === undefined) {
        statusMap.set(sid, 'listening');
        socket.emit('status', { status: 'listening' });
      }
    });

    socket.on('commit_audio', () => {
      logger.info(ctx(sid), '[socketio] commit_audio received');
      voiceClients.get(sid)?.commitAudio();
    });

    socket.on('stop_transcription_stream', async () => {
      logger.info(ctx(sid), '[socketio] stop_transcription_stream');
      const client = voiceClients.get(sid);
      if (client) {
        client.close();
        voiceClients.delete(sid);
        socket.emit('transcription_stopped', { message: 'Transcription stream stopped.' });
      } else {
        socket.emit('error', { message: 'No active transcription stream to stop.' });
      }
      const tts = ttsClients.get(sid);
      if (tts) { tts.close(); ttsClients.delete(sid); }
      ttsEnabled.delete(sid);
      statusMap.delete(sid);
    });

    socket.on('set_tts_enabled', (value: boolean) => {
      ttsEnabled.set(sid, value);
      logger.info(ctx(sid), `[tts] Enabled set to ${value}`);
    });

    socket.on('manual_prompt', (text: string) => {
      if (!text?.trim()) return;
      logger.info(ctx(sid), `[socketio] Manual prompt received, len=${text.length}`);
      ensureSession(sid, socket);
      const sessionId = getActiveSessionId(sid);
      if (sessionId) new SessionStore(sessionId).addInputHistory(text.trim());
      statusMap.set(sid, 'executing');
      socket.emit('status', { status: 'executing' });
      processWithOrchestrator(text.trim(), sid, io);
    });

    socket.on('stop_all', () => {
      logger.info(ctx(sid), '[socketio] stop_all received');
      killAll(sid);
      socket.emit('agents_stopped', { message: 'All agents stopped.' });
    });

    socket.on('disconnect', () => {
      logger.info(ctx(sid), '[socketio] Client disconnected');
      abortAll(sid);
      cleanup(sid);
      socketSession.delete(sid);
      const client = voiceClients.get(sid);
      if (client) {
        client.close();
        voiceClients.delete(sid);
      }
      statusMap.delete(sid);
      readOnlyMap.delete(sid);
      const tts = ttsClients.get(sid);
      if (tts) { tts.close(); ttsClients.delete(sid); }
      ttsEnabled.delete(sid);
    });
  });
}
