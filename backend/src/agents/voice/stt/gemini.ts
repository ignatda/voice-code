import type { VoiceTransport, TranscriptionCallback, StatusCallback, ErrorCallback } from '../types.js';
import logger from '../../../core/logger.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const SILENCE_DURATION_MS = 1000;
const ENERGY_THRESHOLD = 500;

export class GeminiTransport implements VoiceTransport {
  private apiKey: string;
  private sid: string;
  private buffer: Buffer[] = [];
  private silenceTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private onTranscription: TranscriptionCallback | null = null;
  private onStatusChange: StatusCallback | null = null;
  private onError: ErrorCallback | null = null;

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
    this.connected = true;
    logger.info({ sid: this.sid }, '[gemini-stt] Ready for audio');
  }

  sendAudio(base64: string): void {
    if (!this.connected) return;
    const chunk = Buffer.from(base64, 'base64');
    this.buffer.push(chunk);

    if (hasVoiceActivity(chunk)) {
      this.onStatusChange?.('speaking');
      this.resetSilenceTimer();
    }
  }

  commitAudio(): void { this.flushBuffer(); }
  close(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.buffer = [];
    this.connected = false;
  }
  isConnected(): boolean { return this.connected; }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.flushBuffer(), SILENCE_DURATION_MS);
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;
    const pcm = Buffer.concat(this.buffer);
    this.buffer = [];
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }

    this.onStatusChange?.('executing');

    try {
      const transcript = await this.transcribe(pcm);
      if (transcript?.trim()) {
        logger.info({ sid: this.sid }, `[gemini-stt] Transcript: '${transcript}'`);
        this.onTranscription?.(transcript);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ sid: this.sid }, `[gemini-stt] Transcription error: ${msg}`);
      this.onError?.(msg);
    }

    this.onStatusChange?.('idle');
  }

  private async transcribe(pcm16: Buffer): Promise<string> {
    const wav = wrapPcm16AsWav(pcm16, 24000);
    const base64Audio = wav.toString('base64');

    const res = await fetch(`${GEMINI_URL}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Transcribe the audio accurately. Use English for all IT terminology, programming keywords, code-related words, technical terms, and coding concepts (e.g., function, class, variable, array, string, import, return, etc.). Output ONLY the transcript text, nothing else.' },
            { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini STT ${res.status}: ${text}`);
    }

    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}

function hasVoiceActivity(pcm16Buffer: Buffer): boolean {
  const samples = new Int16Array(pcm16Buffer.buffer, pcm16Buffer.byteOffset, pcm16Buffer.byteLength / 2);
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += Math.abs(samples[i]);
  return (energy / samples.length) > ENERGY_THRESHOLD;
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
