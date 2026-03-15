export interface PromptInfo {
  agent: 'browser' | 'ide';
  prompt: string;
}

export interface OrchestratorResult {
  original_text: string;
  prompts: PromptInfo[];
}

export interface BrowserResult {
  status: 'success' | 'error';
  message?: string;
  error?: string;
}

export interface IDEResult {
  agent: 'ide';
  status: 'dummy' | 'success' | 'error';
  message: string;
  received_prompt: string;
  result?: unknown;
}

export type AgentResult = BrowserResult | IDEResult;

export interface AudioStats {
  chunks: number;
  totalBytes: number;
}

export type SessionStatus = 'idle' | 'listening' | 'speaking' | 'processing' | 'executing';

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
  session?: {
    id?: string;
  };
  response?: {
    id?: string;
    status?: string;
  };
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
      input?: {
        format?: {
          type: 'audio/pcm';
          rate: number;
        };
      };
      output?: {
        format?: {
          type: 'audio/pcm';
          rate: number;
        };
      };
    };
  };
}
