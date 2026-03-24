import WebSocket from 'ws';
import type { XAIWebSocketMessage, SessionConfig } from '../../../types/index.js';
import type { VoiceTransport, TranscriptionCallback, StatusCallback, ErrorCallback } from '../types.js';
import logger from '../../../core/logger.js';

const XAI_REALTIME_URL = 'wss://us-east-1.api.x.ai/v1/realtime';

export class XAITransport implements VoiceTransport {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private sid: string;
  private onTranscription: TranscriptionCallback | null = null;
  private onStatusChange: StatusCallback | null = null;
  private onError: ErrorCallback | null = null;
  private connected = false;

  constructor(apiKey: string, sid: string) {
    this.apiKey = apiKey;
    this.sid = sid;
  }

  setCallbacks(onTranscription: TranscriptionCallback, onStatus: StatusCallback, onError: ErrorCallback): void {
    this.onTranscription = onTranscription;
    this.onStatusChange = onStatus;
    this.onError = onError;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(XAI_REALTIME_URL, {
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      });

      this.ws.on('open', () => {
        logger.info({ sid: this.sid }, '[x.ai] Connected to Voice Agent API');
        this.connected = true;
        this.sendSessionConfig();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => this.handleMessage(data.toString()));

      this.ws.on('error', (error) => {
        logger.error({ sid: this.sid }, `[x.ai] WebSocket error: ${error}`);
        this.onError?.(error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        logger.info({ sid: this.sid }, '[x.ai] Connection closed');
        this.connected = false;
      });
    });
  }

  private sendSessionConfig(): void {
    const config: SessionConfig = {
      type: 'session.update',
      session: {
        instructions:
          'Transcribe the audio accurately. Use English for all IT terminology, programming keywords, code-related words, technical terms, and coding concepts (e.g., function, class, variable, array, string, import, return, etc.).',
        turn_detection: { type: 'server_vad', threshold: 0.2, prefix_padding_ms: 500, silence_duration_ms: 1000 },
        audio: { input: { format: { type: 'audio/pcm', rate: 24000 } } },
      },
    };
    this.send(config);
  }

  private handleMessage(rawMessage: string): void {
    try {
      const message: XAIWebSocketMessage = JSON.parse(rawMessage);
      const type = message.type;

      const LOGGED = ['input_audio_buffer.speech_started', 'session.updated', 'error'];
      if (LOGGED.includes(type)) {
        logger.info({ sid: this.sid }, `[x.ai → backend] type=${type}`);
      }

      switch (type) {
        case 'input_audio_buffer.speech_started':
          logger.info({ sid: this.sid }, '[x.ai] Speech started');
          this.onStatusChange?.('speaking');
          break;

        case 'input_audio_buffer.speech_stopped':
          logger.info({ sid: this.sid }, '[x.ai] Speech stopped');
          break;

        case 'conversation.item.added': {
          const item = message.item;
          if (item?.type === 'message' && item?.role === 'user') {
            for (const c of item.content || []) {
              if (c?.type === 'input_audio' && c?.transcript) {
                logger.info({ sid: this.sid }, `[x.ai → backend] Transcript: '${c.transcript}'`);
                this.onTranscription?.(c.transcript);
              }
            }
          }
          break;
        }

        case 'conversation.item.input_audio_transcription.completed': {
          const transcript = message.item?.content?.[0]?.transcript;
          if (transcript) logger.info({ sid: this.sid }, `[x.ai → backend] Final transcript: '${transcript}'`);
          break;
        }

        case 'response.done':
          logger.info({ sid: this.sid }, '[x.ai → backend] Response done');
          this.onStatusChange?.('idle');
          break;

        case 'error':
          logger.error(`[x.ai → backend] Error: ${JSON.stringify(message)}`);
          this.onError?.(JSON.stringify(message));
          break;

        case 'session.updated':
          logger.info({ sid: this.sid }, '[x.ai] Session updated');
          break;
      }
    } catch (error) {
      logger.error(`[x.ai] Error parsing message: ${error}`);
    }
  }

  sendAudio(base64: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
    }
  }

  commitAudio(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      this.ws.send(JSON.stringify({ type: 'response.create', response: { modalities: ['text'] } }));
    }
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
