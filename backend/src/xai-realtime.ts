import WebSocket from 'ws';
import type { XAIWebSocketMessage, SessionConfig } from './types';
import { log, logError } from './log.js';

const XAI_REALTIME_URL = 'wss://us-east-1.api.x.ai/v1/realtime';

export type TranscriptionCallback = (transcript: string) => void;
export type StatusCallback = (status: string) => void;
export type ErrorCallback = (error: string) => void;

export class XAIVoiceClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private sessionSid: string;
  private onTranscription: TranscriptionCallback | null = null;
  private onStatusChange: StatusCallback | null = null;
  private onError: ErrorCallback | null = null;
  private isConnected: boolean = false;

  constructor(apiKey: string, sid: string) {
    this.apiKey = apiKey;
    this.sessionSid = sid;
  }

  setCallbacks(
    onTranscription: TranscriptionCallback,
    onStatusChange: StatusCallback,
    onError: ErrorCallback
  ): void {
    this.onTranscription = onTranscription;
    this.onStatusChange = onStatusChange;
    this.onError = onError;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(XAI_REALTIME_URL, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      this.ws.on('open', () => {
        log(`[x.ai] Connected to Voice Agent API`, this.sessionSid);
        this.isConnected = true;
        this.sendSessionConfig();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (error) => {
        logError(`[x.ai] WebSocket error: ${error}`, this.sessionSid);
        if (this.onError) {
          this.onError(error.message);
        }
        reject(error);
      });

      this.ws.on('close', () => {
        log(`[x.ai] Connection closed`, this.sessionSid);
        this.isConnected = false;
      });
    });
  }

  private sendSessionConfig(): void {
    const config: SessionConfig = {
      type: 'session.update',
      session: {
        instructions:
          'Transcribe the audio accurately. Use English for all IT terminology, programming keywords, code-related words, technical terms, and coding concepts (e.g., function, class, variable, array, string, import, return, etc.). Use Russian only for general conversational words and non-technical speech.',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.2,
          prefix_padding_ms: 500,
          silence_duration_ms: 1000,
        },
        audio: {
          input: {
            format: {
              type: 'audio/pcm',
              rate: 24000,
            },
          },
        },
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
        log(`[x.ai → backend] type=${type}`, this.sessionSid);
      }

      switch (type) {
        case 'input_audio_buffer.speech_started':
          log(`[x.ai] Speech started`, this.sessionSid);
          if (this.onStatusChange) {
            this.onStatusChange('speaking');
          }
          break;

        case 'input_audio_buffer.speech_stopped':
          log(`[x.ai] Speech stopped`, this.sessionSid);
          break;

        case 'conversation.item.added': {
          const item = message.item;
          if (item?.type === 'message' && item?.role === 'user') {
            const content = item.content || [];
            for (const c of content) {
              if (c?.type === 'input_audio' && c?.transcript) {
                const transcript = c.transcript;
                log(`[x.ai → backend] Transcript: '${transcript}'`, this.sessionSid);
                if (this.onTranscription) {
                  this.onTranscription(transcript);
                }
              }
            }
          }
          break;
        }

        case 'conversation.item.input_audio_transcription.completed': {
          const transcript = message.item?.content?.[0]?.transcript;
          if (transcript) {
            log(`[x.ai → backend] Final transcript: '${transcript}'`, this.sessionSid);
          }
          break;
        }

        case 'response.done':
          log(`[x.ai → backend] Response done`, this.sessionSid);
          if (this.onStatusChange) {
            this.onStatusChange('idle');
          }
          break;

        case 'error':
          logError(`[x.ai → backend] Error: ${JSON.stringify(message)}`);
          if (this.onError) {
            this.onError(JSON.stringify(message));
          }
          break;

        case 'session.updated':
          log(`[x.ai] Session updated`, this.sessionSid);
          break;

        default:
          break;
      }
    } catch (error) {
      logError(`[x.ai] Error parsing message: ${error}`);
    }
  }

  sendAudio(audioBase64: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: audioBase64,
        })
      );
    }
  }

  commitAudio(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      this.ws.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text'],
          },
        })
      );
    }
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
