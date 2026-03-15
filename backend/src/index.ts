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
const { log } = await import('./log.js');
log('[init] Loading .env from: ' + envPath);
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
    log(`[interrupt] Stop command detected`, sid);
    abortAll(sid);
    jetbrainsAgent.killTerminalProcess();
    io.to(sid).emit('agents_stopped', { message: 'All agents stopped.' });
    return;
  }

  const isReadOnly = readOnlyMap.get(sid) ?? false;
  log(`[orchestrator] Processing transcription, text_len=${transcription.length}, readOnly=${isReadOnly}`, sid);

  const result = await orchestratorAgent.process(transcription, isReadOnly);

  log(`[orchestrator] Generated ${result.prompts.length} prompts`, sid);
  io.to(sid).emit('transcription_result', result);

  for (const promptInfo of result.prompts) {
    const signal = createSignal(sid);
    if (promptInfo.agent === 'browser') {
      runBrowserCommand(promptInfo.prompt, sid, signal, isReadOnly);
    } else if (promptInfo.agent === 'jetbrains') {
      jetbrainsAgent.process(promptInfo.prompt, signal, isReadOnly).then((result) => {
        io.to(sid).emit('ide_result', result);
      }).catch((error) => {
        log(`[jetbrains_agent] Error: ${error}`, sid);
        io.to(sid).emit('ide_result', { agent: 'jetbrains', status: 'error', message: String(error), received_prompt: promptInfo.prompt });
      });
    }
  }
}

function runBrowserCommand(prompt: string, sid: string, signal?: AbortSignal, readOnly?: boolean): void {
  log(`[browser_agent] Processing command: ${prompt}`, sid);
  browserAgent
    .process(prompt, signal, readOnly)
    .then((result) => {
      io.to(sid).emit('browser_result', result);
    })
    .catch((error) => {
      log(`[browser_agent] Error: ${error}`, sid);
      io.to(sid).emit('browser_result', { status: 'error', error: String(error) });
    });
}

io.on('connection', (socket) => {
  const sid = socket.id;

  log('[socketio] Client connected', sid);

  socket.on('set_read_only', (value: boolean) => {
    readOnlyMap.set(sid, !!value);
    log(`[socketio] Read-only mode set to ${!!value}`, sid);
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
        log(`[x.ai] Error: ${error}`, sid);
        io.to(sid).emit('error', { message: error });
      }
    );

    try {
      await xaiClient.connect();
      xaiClients.set(sid, xaiClient);

      socket.emit('transcription_started', { message: 'Connected to x.ai and ready for audio.' });
      socket.emit('status', { status: 'idle' });
      log('[socketio] Transcription stream started', sid);
    } catch (error) {
      log(`[x.ai] Failed to connect: ${error}`, sid);
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
    log('[socketio] commit_audio received', sid);
    const xaiClient = xaiClients.get(sid);
    if (xaiClient) {
      xaiClient.commitAudio();
    }
  });

  socket.on('stop_transcription_stream', async () => {
    log('[socketio] stop_transcription_stream', sid);
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

  socket.on('stop_all', () => {
    log('[socketio] stop_all received', sid);
    abortAll(sid);
    jetbrainsAgent.killTerminalProcess();
    socket.emit('agents_stopped', { message: 'All agents stopped.' });
  });

  socket.on('disconnect', () => {
    log('[socketio] Client disconnected', sid);
    abortAll(sid);
    cleanup(sid);
    const xaiClient = xaiClients.get(sid);
    if (xaiClient) {
      log('[x.ai] Closing connection due to client disconnect', sid);
      xaiClient.close();
      xaiClients.delete(sid);
    }
    statusMap.delete(sid);
    readOnlyMap.delete(sid);
  });
});

httpServer.listen(PORT, () => {
  log(`Server running on port ${PORT}`);
});
