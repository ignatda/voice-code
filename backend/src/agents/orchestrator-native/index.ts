export type TranscriptCallback = (transcript: string) => void;
export type AudioChunkCallback = (base64Audio: string) => void;
export type AudioDoneCallback = () => void;
export type ToolResultCallback = (agent: string, status: string, message: string) => void;
export type StatusCallback = (status: string) => void;
export type ErrorCallback = (error: string) => void;

export interface NativeOrchestrator {
  connect(): Promise<void>;
  sendAudio(base64: string): void;
  sendText(text: string): void;
  close(): void;
  isConnected(): boolean;
  setCallbacks(
    onTranscript: TranscriptCallback,
    onAudioChunk: AudioChunkCallback,
    onAudioDone: AudioDoneCallback,
    onToolResult: ToolResultCallback,
    onStatus: StatusCallback,
    onError: ErrorCallback,
  ): void;
}

export interface NativeOrchestratorOpts {
  ideType: string;
  codingCli: string;
}

const NATIVE_PROVIDERS = new Set(['xai']);

export function supportsNative(provider: string): boolean {
  return NATIVE_PROVIDERS.has(provider);
}

export async function createNativeOrchestrator(
  provider: string, apiKey: string, sid: string, opts: NativeOrchestratorOpts,
): Promise<NativeOrchestrator> {
  switch (provider) {
    case 'xai':
    default: {
      const { XAINativeOrchestrator } = await import('./xai.js');
      return new XAINativeOrchestrator(apiKey, sid, opts);
    }
  }
}
