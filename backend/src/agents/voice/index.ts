export type { VoiceTransport, TranscriptionCallback, StatusCallback, ErrorCallback } from './types.js';
import type { VoiceTransport } from './types.js';
import { XAITransport } from './transports/xai.js';
import { GroqTransport } from './transports/groq.js';

export function createVoiceClient(provider: string, apiKey: string, sid: string): VoiceTransport {
  switch (provider) {
    case 'groq': return new GroqTransport(apiKey, sid);
    case 'xai':
    default:     return new XAITransport(apiKey, sid);
  }
}

// Backward compat alias
export { XAITransport as XAIVoiceClient } from './transports/xai.js';
