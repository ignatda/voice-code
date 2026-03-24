import type { TTSTransport, AudioChunkCallback, TTSDoneCallback, TTSErrorCallback } from '../tts-types.js';
import logger from '../../../core/logger.js';

const GEMINI_TTS_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent';

export class GeminiTTSTransport implements TTSTransport {
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
      const res = await fetch(`${GEMINI_TTS_URL}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
            },
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini TTS ${res.status}: ${errText}`);
      }

      const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> };
      const audioBase64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioBase64) throw new Error('No audio data in Gemini TTS response');

      // Gemini returns raw PCM16 24kHz mono — wrap in WAV header for browser playback
      const pcm = Buffer.from(audioBase64, 'base64');
      const wav = wrapPcm16AsWav(pcm, 24000);
      logger.info({ sid: this.sid }, `[gemini-tts] Generated ${wav.length} bytes`);
      this.onAudioChunk?.(wav.toString('base64'));
      this.onDone?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ sid: this.sid }, `[gemini-tts] Error: ${msg}`);
      this.onError?.(msg);
    }
  }

  close(): void {}
}

function wrapPcm16AsWav(pcm16: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm16.byteLength;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm16]);
}
