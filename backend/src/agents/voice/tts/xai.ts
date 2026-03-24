import type { TTSTransport, AudioChunkCallback, TTSDoneCallback, TTSErrorCallback } from '../tts-types.js';
import logger from '../../../core/logger.js';

const XAI_TTS_URL = 'https://api.x.ai/v1/tts';

export class XAITTSTransport implements TTSTransport {
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
      const res = await fetch(XAI_TTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voice_id: 'sal',
          language: 'auto',
          output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 128000 },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`x.ai TTS ${res.status}: ${errText}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      logger.info({ sid: this.sid }, `[xai-tts] Generated ${buffer.length} bytes`);
      this.onAudioChunk?.(buffer.toString('base64'));
      this.onDone?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ sid: this.sid }, `[xai-tts] Error: ${msg}`);
      this.onError?.(msg);
    }
  }

  close(): void {
    // REST-based — nothing to clean up
  }
}
