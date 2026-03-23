export interface XAIWebSocketMessage {
  type: string;
  event_id?: string;
  item?: {
    id?: string;
    type?: string;
    role?: string;
    content?: Array<{
      type?: string;
      transcript?: string;
      text?: string;
    }>;
  };
  session?: { id?: string };
  response?: { id?: string; status?: string };
}

export interface SessionConfig {
  type: 'session.update';
  session: {
    voice?: string;
    instructions: string;
    turn_detection?: {
      type: 'server_vad' | null;
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
    };
    audio?: {
      input?: { format?: { type: 'audio/pcm'; rate: number } };
      output?: { format?: { type: 'audio/pcm'; rate: number } };
    };
  };
}
