export type TranscriptionCallback = (transcript: string) => void;
export type StatusCallback = (status: string) => void;
export type ErrorCallback = (error: string) => void;

export interface VoiceTransport {
  connect(): Promise<void>;
  sendAudio(base64: string): void;
  commitAudio(): void;
  close(): void;
  setCallbacks(
    onTranscription: TranscriptionCallback,
    onStatus: StatusCallback,
    onError: ErrorCallback,
  ): void;
  isConnected(): boolean;
}
