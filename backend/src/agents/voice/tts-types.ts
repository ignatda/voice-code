export type AudioChunkCallback = (base64Audio: string) => void;
export type TTSDoneCallback = () => void;
export type TTSErrorCallback = (error: string) => void;

export interface TTSTransport {
  synthesize(text: string): Promise<void>;
  setCallbacks(
    onAudioChunk: AudioChunkCallback,
    onDone: TTSDoneCallback,
    onError: TTSErrorCallback,
  ): void;
  close(): void;
}
