import type { VoiceTransport, TranscriptionCallback, StatusCallback, ErrorCallback } from '../types.js';
import logger from '../../../core/logger.js';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const SILENCE_DURATION_MS = 1000;
const ENERGY_THRESHOLD = 500;

export class GroqTransport implements VoiceTransport {
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
    logger.info({ sid: this.sid }, '[groq-whisper] Ready for audio');
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

  commitAudio(): void {
    this.flushBuffer();
  }

  close(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.buffer = [];
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

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
        logger.info({ sid: this.sid }, `[groq-whisper] Transcript: '${transcript}'`);
        this.onTranscription?.(transcript);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ sid: this.sid }, `[groq-whisper] Transcription error: ${msg}`);
      this.onError?.(msg);
    }

    this.onStatusChange?.('idle');
  }

  private async transcribe(pcm16: Buffer): Promise<string> {
    const wav = wrapPcm16AsWav(pcm16, 24000);
    const boundary = '----VoiceCodeBoundary' + Date.now();
    const filename = 'audio.wav';

    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`
    );
    const modelPart = Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3`
    );
    const langPart = Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, wav, modelPart, langPart, footer]);

    const res = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq Whisper ${res.status}: ${text}`);
    }

    const data = await res.json() as { text?: string };
    return data.text || '';
  }
}

/** Simple energy-based VAD: check if PCM16 samples exceed threshold */
function hasVoiceActivity(pcm16Buffer: Buffer): boolean {
  const samples = new Int16Array(pcm16Buffer.buffer, pcm16Buffer.byteOffset, pcm16Buffer.byteLength / 2);
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += Math.abs(samples[i]);
  return (energy / samples.length) > ENERGY_THRESHOLD;
}

/** Wrap raw PCM16 mono data in a minimal WAV header */
function wrapPcm16AsWav(pcm16: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm16.byteLength;
  const fileSize = 36 + dataSize;

  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);       // fmt chunk size
  header.writeUInt16LE(1, 20);        // PCM format
  header.writeUInt16LE(1, 22);        // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);        // block align
  header.writeUInt16LE(16, 34);       // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm16]);
}
