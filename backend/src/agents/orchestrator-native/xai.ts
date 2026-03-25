import WebSocket from 'ws';
import type {
  NativeOrchestrator, NativeOrchestratorOpts,
  TranscriptCallback, AudioChunkCallback, AudioDoneCallback,
  ToolResultCallback, StatusCallback, ErrorCallback,
} from './index.js';
import { buildToolSchemas } from './tools.js';
import { buildNativeInstructions } from './instructions.js';
import { executeTool } from './tool-executor.js';
import logger from '../../core/logger.js';

const XAI_REALTIME_URL = 'wss://api.x.ai/v1/realtime';

interface PendingToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export class XAINativeOrchestrator implements NativeOrchestrator {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private sid: string;
  private opts: NativeOrchestratorOpts;
  private connected = false;
  private onTranscript: TranscriptCallback | null = null;
  private onAudioChunk: AudioChunkCallback | null = null;
  private onAudioDone: AudioDoneCallback | null = null;
  private onToolResult: ToolResultCallback | null = null;
  private onStatus: StatusCallback | null = null;
  private onError: ErrorCallback | null = null;
  private pendingToolCalls: PendingToolCall[] = [];
  private awaitingToolResponse = false;
  private currentResponseText = '';
  private currentResponseHasAudio = false;

  constructor(apiKey: string, sid: string, opts: NativeOrchestratorOpts) {
    this.apiKey = apiKey;
    this.sid = sid;
    this.opts = opts;
  }

  setCallbacks(
    onTranscript: TranscriptCallback, onAudioChunk: AudioChunkCallback,
    onAudioDone: AudioDoneCallback, onToolResult: ToolResultCallback,
    onStatus: StatusCallback, onError: ErrorCallback,
  ): void {
    this.onTranscript = onTranscript;
    this.onAudioChunk = onAudioChunk;
    this.onAudioDone = onAudioDone;
    this.onToolResult = onToolResult;
    this.onStatus = onStatus;
    this.onError = onError;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(XAI_REALTIME_URL, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      this.ws.on('open', () => {
        logger.info({ sid: this.sid }, '[native-xai] Connected');
        this.connected = true;
        this.sendSessionConfig();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => this.handleMessage(data.toString()));

      this.ws.on('error', (error) => {
        logger.error({ sid: this.sid }, `[native-xai] WebSocket error: ${error}`);
        this.onError?.(error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        logger.info({ sid: this.sid }, '[native-xai] Connection closed');
        this.connected = false;
      });
    });
  }

  private sendSessionConfig(): void {
    const tools = buildToolSchemas(this.opts);
    const instructions = buildNativeInstructions(this.opts);
    this.send({
      type: 'session.update',
      session: {
        voice: 'Sal',
        instructions,
        turn_detection: { type: 'server_vad', threshold: 0.2, prefix_padding_ms: 500, silence_duration_ms: 1000 },
        tools,
        audio: {
          input: { format: { type: 'audio/pcm', rate: 24000 } },
          output: { format: { type: 'audio/pcm', rate: 24000 } },
        },
      },
    });
  }

  private handleMessage(rawMessage: string): void {
    try {
      const message = JSON.parse(rawMessage);
      const type = message.type as string;

      switch (type) {
        case 'input_audio_buffer.speech_started':
          logger.info({ sid: this.sid }, '[native-xai] Speech started');
          this.onStatus?.('speaking');
          break;

        case 'input_audio_buffer.speech_stopped':
          logger.info({ sid: this.sid }, '[native-xai] Speech stopped');
          break;

        case 'conversation.item.added': {
          const item = message.item;
          if (item?.type === 'message' && item?.role === 'user') {
            for (const c of item.content || []) {
              if (c?.type === 'input_audio' && c?.transcript) {
                logger.info({ sid: this.sid }, `[native-xai] Transcript: '${c.transcript}'`);
                this.onTranscript?.(c.transcript);
              }
            }
          }
          break;
        }

        case 'response.output_audio.delta':
          if (message.delta) {
            this.currentResponseHasAudio = true;
            this.onAudioChunk?.(message.delta);
          }
          break;

        case 'response.output_audio_transcript.delta':
          if (message.delta) this.currentResponseText += message.delta;
          break;

        case 'response.created':
          this.currentResponseText = '';
          this.currentResponseHasAudio = false;
          break;

        case 'response.output_audio.done':
          this.onAudioDone?.();
          break;

        case 'response.function_call_arguments.done':
          this.pendingToolCalls.push({
            callId: message.call_id,
            name: message.name,
            arguments: message.arguments,
          });
          break;

        case 'response.done':
          logger.info({ sid: this.sid }, '[native-xai] Response done');
          if (this.pendingToolCalls.length > 0) {
            this.executeToolCalls();
          } else {
            if (this.currentResponseText) {
              this.onToolResult?.('orchestrator', 'success', this.currentResponseText);
            }
            this.onStatus?.('idle');
          }
          break;

        case 'error':
          logger.error({ sid: this.sid }, `[native-xai] Error: ${JSON.stringify(message.error || message)}`);
          this.onError?.(message.error?.message || JSON.stringify(message));
          break;

        case 'session.updated':
          logger.info({ sid: this.sid }, '[native-xai] Session updated');
          break;
      }
    } catch (error) {
      logger.error(`[native-xai] Parse error: ${error}`);
    }
  }

  private async executeToolCalls(): Promise<void> {
    const calls = [...this.pendingToolCalls];
    this.pendingToolCalls = [];
    this.awaitingToolResponse = true;
    this.onStatus?.('executing');

    for (const call of calls) {
      let args: Record<string, any>;
      try { args = JSON.parse(call.arguments); } catch { args = {}; }

      logger.info({ sid: this.sid }, `[native-xai] Tool call: ${call.name}(${call.arguments})`);
      const result = await executeTool(call.name, args, { ...this.opts, sid: this.sid });
      logger.info({ sid: this.sid }, `[native-xai] Tool result: ${result.slice(0, 200)}`);

      // Emit to UI with agent name
      const agent = call.name === 'browse_web' ? 'browser' : call.name === 'plan_feature' ? 'planner' : 'ide';
      // Clean up MCP JSON wrapper if present
      let displayResult = result;
      try {
        const parsed = JSON.parse(result);
        if (Array.isArray(parsed)) displayResult = parsed.map((p: any) => p.text || JSON.stringify(p)).join('\n');
        else if (parsed.text) displayResult = parsed.text;
        else if (parsed.tree) displayResult = parsed.tree;
      } catch { /* not JSON, use as-is */ }
      this.onToolResult?.(agent, 'success', displayResult.slice(0, 16000));

      // Send result back to xAI (not to UI — let the model summarize)
      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call.callId,
          output: result.slice(0, 16000),
        },
      });
    }

    // Continue conversation — model will speak a summary
    this.send({ type: 'response.create' });
    this.awaitingToolResponse = false;
  }

  sendAudio(base64: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
    }
  }

  sendText(text: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    logger.info({ sid: this.sid }, `[native-xai] sendText: ${text.slice(0, 100)}`);
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
    this.send({ type: 'response.create' });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
