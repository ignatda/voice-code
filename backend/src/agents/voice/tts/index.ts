import type { TTSTransport } from '../tts-types.js';
import { XAITTSTransport } from './xai.js';
import { GroqTTSTransport } from './groq.js';
import { GeminiTTSTransport } from './gemini.js';

export function createTTSClient(provider: string, apiKey: string, sid: string): TTSTransport {
  switch (provider) {
    case 'groq':   return new GroqTTSTransport(apiKey, sid);
    case 'gemini': return new GeminiTTSTransport(apiKey, sid);
    case 'xai':
    default:
      return new XAITTSTransport(apiKey, sid);
  }
}
