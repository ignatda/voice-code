import type { TTSTransport, AudioChunkCallback, TTSDoneCallback, TTSErrorCallback } from '../tts-types.js';
import logger from '../../../core/logger.js';

const GROQ_TTS_URL = 'https://api.groq.com/openai/v1/audio/speech';

export class GroqTTSTransport implements TTSTransport {
  private apiKey: string;
  private sid: string;
  private onAudioChunk: AudioChunkCallback | null = null;
  private onDone: TTSDoneCallback | null = null;
  private onError: TTSErrorCallback | null = null;

  constructor(apiKey: string, sid: string) {
    this.apiKey = apiKey;
    this.sid = sid;
  }

  setCallbacks(onAudioChunk: AudioChunkCallback, onDone: TTSDoneCallback, onError: TTSErrorCallback): void {
    this.onAudioChunk = onAudioChunk;
    this.onDone = onDone;
    this.onError = onError;
  }

  async synthesize(text: string): Promise<void> {
    try {
      const res = await fetch(GROQ_TTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'canopylabs/orpheus-v1-english',
          input: text,
          voice: 'troy',
          response_format: 'wav',
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq TTS ${res.status}: ${errText}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      logger.info({ sid: this.sid }, `[groq-tts] Generated ${buffer.length} bytes`);
      this.onAudioChunk?.(buffer.toString('base64'));
      this.onDone?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ sid: this.sid }, `[groq-tts] Error: ${msg}`);
      this.onError?.(msg);
    }
  }

  close(): void {}
}
