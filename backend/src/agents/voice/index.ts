export type { VoiceTransport, TranscriptionCallback, StatusCallback, ErrorCallback } from './types.js';
export type { TTSTransport, AudioChunkCallback, TTSDoneCallback, TTSErrorCallback } from './tts-types.js';
import type { VoiceTransport } from './types.js';
import { XAITransport } from './stt/xai.js';
import { GroqTransport } from './stt/groq.js';
import { GeminiTransport } from './stt/gemini.js';
export { createTTSClient } from './tts/index.js';

export function createSTTClient(provider: string, apiKey: string, sid: string): VoiceTransport {
  switch (provider) {
    case 'groq':   return new GroqTransport(apiKey, sid);
    case 'gemini': return new GeminiTransport(apiKey, sid);
    case 'xai':
    default:       return new XAITransport(apiKey, sid);
  }
}

// Backward compat alias
export { XAITransport as XAIVoiceClient } from './stt/xai.js';
