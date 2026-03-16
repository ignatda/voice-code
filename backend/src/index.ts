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
const { OrchestratorAgent, BrowserAgent, JetBrainsAgent } = await import('./agents/index.js');
const { createSignal, abortAll, cleanup, isStopCommand } = await import('./interrupt.js');

const XAI_API_KEY = process.env.OPENAI_API_KEY || process.env.XAI_API_KEY;
const PORT = parseInt(process.env.PORT || '5000');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});
const statusMap = new Map<string, string>();
const readOnlyMap = new Map<string, boolean>();
const xaiClients = new Map<string, InstanceType<typeof XAIVoiceClient>>();

const orchestratorAgent = new OrchestratorAgent(XAI_API_KEY || '');
const browserAgent = new BrowserAgent();
const jetbrainsAgent = new JetBrainsAgent();

async function processWithOrchestrator(transcription: string, sid: string): Promise<void> {
  if (isStopCommand(transcription)) {
    logger.info({ sid }, '[interrupt] Stop command detected');
    abortAll(sid);
    jetbrainsAgent.killTerminalProcess();
    io.to(sid).emit('agents_stopped', { message: 'All agents stopped.' });
    return;
  }

  const isReadOnly = readOnlyMap.get(sid) ?? false;
  logger.info({ sid }, `[orchestrator] Processing transcription, text_len=${transcription.length}, readOnly=${isReadOnly}`);

  const result = await orchestratorAgent.process(transcription, isReadOnly, sid);

  logger.info({ sid }, `[orchestrator] Generated ${result.prompts.length} prompts`);
  io.to(sid).emit('transcription_result', result);

  for (const promptInfo of result.prompts) {
    const signal = createSignal(sid);
    if (promptInfo.agent === 'browser') {
      runBrowserCommand(promptInfo.prompt, sid, signal, isReadOnly);
    } else if (promptInfo.agent === 'jetbrains') {
      jetbrainsAgent.process(promptInfo.prompt, signal, isReadOnly).then((result) => {
        io.to(sid).emit('ide_result', result);
      }).catch((error) => {
        logger.info({ sid }, `[jetbrains_agent] Error: ${error}`);
        io.to(sid).emit('ide_result', { agent: 'jetbrains', status: 'error', message: String(error), received_prompt: promptInfo.prompt });
      });
    }
  }
}

function runBrowserCommand(prompt: string, sid: string, signal?: AbortSignal, readOnly?: boolean): void {
  logger.info({ sid }, `[browser_agent] Processing command: ${prompt}`);
  browserAgent
    .process(prompt, signal, readOnly)
    .then((result) => {
      io.to(sid).emit('browser_result', result);
    })
    .catch((error) => {
      logger.info({ sid }, `[browser_agent] Error: ${error}`);
      io.to(sid).emit('browser_result', { status: 'error', error: String(error) });
    });
}

io.on('connection', (socket) => {
  const sid = socket.id;

  logger.info({ sid }, '[socketio] Client connected');

  socket.on('set_read_only', (value: boolean) => {
    readOnlyMap.set(sid, value);
    logger.info({ sid }, `[socketio] Read-only mode set to ${value}`);
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
    orchestratorAgent.clearHistory(sid);
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
