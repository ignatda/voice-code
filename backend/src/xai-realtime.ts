import WebSocket from 'ws';
import type { XAIWebSocketMessage, SessionConfig } from './types';

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
        console.log(`[x.ai] Connected to Voice Agent API, sid=${this.sessionSid.slice(0, 8)}`);
        this.isConnected = true;
        this.sendSessionConfig();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (error) => {
        console.error(`[x.ai] WebSocket error: ${error}, sid=${this.sessionSid.slice(0, 8)}`);
        if (this.onError) {
          this.onError(error.message);
        }
        reject(error);
      });

      this.ws.on('close', () => {
        console.log(`[x.ai] Connection closed, sid=${this.sessionSid.slice(0, 8)}`);
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

      console.log(`[x.ai → backend] type=${type}, sid=${this.sessionSid.slice(0, 8)}`);

      switch (type) {
        case 'input_audio_buffer.speech_started':
          console.log(`[x.ai] Speech started, sid=${this.sessionSid.slice(0, 8)}`);
          if (this.onStatusChange) {
            this.onStatusChange('speaking');
          }
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log(`[x.ai] Speech stopped, sid=${this.sessionSid.slice(0, 8)}`);
          break;

        case 'conversation.item.added': {
          const item = message.item;
          if (item?.type === 'message' && item?.role === 'user') {
            const content = item.content || [];
            for (const c of content) {
              if (c?.type === 'input_audio' && c?.transcript) {
                const transcript = c.transcript;
                console.log(`[x.ai → backend] Transcript: '${transcript}', sid=${this.sessionSid.slice(0, 8)}`);
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
            console.log(`[x.ai → backend] Final transcript: '${transcript}', sid=${this.sessionSid.slice(0, 8)}`);
          }
          break;
        }

        case 'response.done':
          console.log(`[x.ai → backend] Response done, sid=${this.sessionSid.slice(0, 8)}`);
          if (this.onStatusChange) {
            this.onStatusChange('idle');
          }
          break;

        case 'error':
          console.error(`[x.ai → backend] Error: ${JSON.stringify(message)}`);
          if (this.onError) {
            this.onError(JSON.stringify(message));
          }
          break;

        case 'session.updated':
          console.log(`[x.ai] Session updated, sid=${this.sessionSid.slice(0, 8)}`);
          break;

        default:
          break;
      }
    } catch (error) {
      console.error(`[x.ai] Error parsing message: ${error}`);
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
