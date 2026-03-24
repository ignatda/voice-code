# Voice Response (Text-to-Speech)

## Overview

Add TTS (text-to-speech) capability so agent responses are spoken back to the user. Mirrors the existing STT transport architecture (`agents/voice/stt/`) but in reverse: text in → audio out.

## Current State

- STT transports exist in `agents/voice/transports/` for 3 providers: `xai` (WebSocket realtime), `groq` (batch Whisper), `gemini` (batch multimodal) — will be renamed to `agents/voice/stt/` as step 1
- All implement `VoiceTransport` interface (connect, sendAudio, commitAudio, close)
- Frontend receives agent text via Socket.IO events (`ide_result`, `browser_result`, `transcription_result`)
- No TTS exists — `audio_delta` event is mentioned in AGENTS.md but unused

## Design

### Architecture

```
Agent response (text) → Router → TTS Transport → audio chunks → Socket.IO → Frontend → Web Audio playback
```

### Backend

#### 1. TTS Transport Interface

New file: `backend/src/agents/voice/tts-types.ts`

```typescript
export type AudioChunkCallback = (base64Audio: string) => void;
export type TTSDoneCallback = () => void;
export type TTSErrorCallback = (error: string) => void;

export interface TTSTransport {
  synthesize(text: string): Promise<void>;  // streams audio chunks via callback
  setCallbacks(
    onAudioChunk: AudioChunkCallback,
    onDone: TTSDoneCallback,
    onError: TTSErrorCallback,
  ): void;
  close(): void;
}
```

#### 2. TTS Transport Implementations

New directory: `backend/src/agents/voice/tts/`

| File | Provider | API | Approach |
|---|---|---|---|
| `xai.ts` | x.ai | `POST /v1/audio/speech` | Streaming — read response body as chunks, emit `audio_delta` per chunk |
| `groq.ts` | Groq | `POST /openai/v1/audio/speech` | Streaming — same OpenAI-compatible endpoint |
| `gemini.ts` | Google | Gemini multimodal generate with `audio` modality | Single response — base64 audio in JSON, emit as one chunk |

All transports:
- Accept text, produce PCM16 24kHz mono audio (matching existing frontend audio format)
- Stream chunks via `onAudioChunk` callback as base64
- Call `onDone` when synthesis completes

#### 3. TTS Factory

New file: `backend/src/agents/voice/tts/index.ts`

```typescript
export function createTTSClient(provider: string, apiKey: string, sid: string): TTSTransport
```

Provider selection via `TTS_PROVIDER` env var (defaults to matching `STT_PROVIDER`, falls back to first available LLM provider key).

#### 4. Router Integration

In `router.ts` — after each agent response is emitted, pipe the response text through TTS:

```
processWithOrchestrator() → agent produces output → emit result event → if TTS enabled, synthesize(output)
```

- New per-socket map: `ttsClients: Map<string, TTSTransport>`
- TTS callbacks emit `voice_response_delta` (audio chunk) and `voice_response_done` to the frontend
- TTS is opt-in: only active when the voice stream is active (user is in voice mode)
- Agent filter: only Orchestrator agent responses trigger TTS (IDE Agent, Browser Agent, and Planner are skipped — their outputs are code/technical and not suitable for speech)
- Handoff narration: when the Orchestrator hands off to another agent, it should emit a brief spoken status message before the handoff (e.g. "I'm passing this to the IDE agent to refactor the function"). This keeps the user informed via voice about what's happening. The narration is also displayed as text in the UI (emitted as a regular agent message). The Orchestrator prompt must be updated to instruct it to always produce a short spoken summary when delegating.
- Guard: skip TTS for very long outputs (e.g. planner plans, code blocks) — configurable threshold

#### 5. Configuration

New env vars in `.env`:

| Variable | Values | Default | Description |
|---|---|---|---|
| `TTS_PROVIDER` | `xai`, `groq`, `gemini`, `none` | (same as STT_PROVIDER) | TTS provider |
| `TTS_ENABLED` | `true`, `false` | `true` | Master TTS toggle |
| `TTS_MAX_LENGTH` | number | `500` | Skip TTS for responses longer than this (chars) |

### Frontend

#### 1. Audio Playback

In `App.jsx` — add Web Audio API playback:

- Listen for `voice_response_delta` events → decode base64 PCM16 → queue into AudioContext buffer
- Listen for `voice_response_done` → flush remaining buffer
- Smooth playback: use a buffer queue to avoid gaps between chunks
- Auto-interrupt: if user starts speaking (microphone active + VAD), stop current playback

#### 2. UI Controls

- Toggle button in the voice controls area: 🔊 / 🔇 to enable/disable voice responses
- Visual indicator when TTS is playing (e.g. pulsing speaker icon)
- Socket event `set_tts_enabled` to toggle server-side

### Socket.IO Events (new)

| Event | Direction | Payload | Description |
|---|---|---|---|
| `voice_response_delta` | server → client | `{ audio: string }` | Base64 PCM16 audio chunk |
| `voice_response_done` | server → client | `{}` | TTS finished for current response |
| `set_tts_enabled` | client → server | `boolean` | Toggle TTS on/off |

## File Changes

### New Files
- `backend/src/agents/voice/tts-types.ts` — TTSTransport interface
- `backend/src/agents/voice/tts/index.ts` — factory
- `backend/src/agents/voice/tts/xai.ts` — x.ai TTS transport
- `backend/src/agents/voice/tts/groq.ts` — Groq TTS transport
- `backend/src/agents/voice/tts/gemini.ts` — Gemini TTS transport

### Modified Files
- `backend/src/router.ts` — TTS lifecycle (create/destroy with voice stream), pipe agent output to TTS
- `backend/src/core/config.ts` — add `TTS_PROVIDER`, `TTS_ENABLED`, `TTS_MAX_LENGTH` to settings snapshot
- `backend/.env.example` — document new env vars
- `frontend/src/App.jsx` — audio playback via Web Audio API, TTS toggle button
- `AGENTS.md` — document `voice_response_delta`, `voice_response_done`, `set_tts_enabled` events

## Implementation Checklist

### Phase 1: Rename STT directory
- [x] Rename `agents/voice/transports/` → `agents/voice/stt/`
- [x] Update imports in `agents/voice/index.ts` (`./transports/` → `./stt/`)
- [x] Update imports in `router.ts` if any direct transport imports exist
- [x] Verify backend compiles (`npm run build`)

### Phase 2: TTS interface & types
- [x] Create `agents/voice/tts-types.ts` with `TTSTransport` interface
- [x] Add `AudioChunkCallback`, `TTSDoneCallback`, `TTSErrorCallback` types
- [x] Export TTS types from `agents/voice/index.ts`

### Phase 3: x.ai TTS transport
- [ ] Create `agents/voice/tts/xai.ts` implementing `TTSTransport`
- [ ] Implement `synthesize()` — POST to `/v1/audio/speech`, stream response body
- [ ] Chunk response into base64 PCM16 segments, emit via `onAudioChunk`
- [ ] Handle errors (non-200, network failures) via `onError`
- [ ] Test with a hardcoded string to verify audio output format

### Phase 4: TTS factory
- [ ] Create `agents/voice/tts/index.ts` with `createTTSClient()` factory
- [ ] Wire provider selection logic (read `TTS_PROVIDER` env var)
- [ ] Re-export from `agents/voice/index.ts`

### Phase 5: Backend configuration
- [ ] Add `TTS_PROVIDER`, `TTS_ENABLED`, `TTS_MAX_LENGTH` to `core/config.ts` settings snapshot
- [ ] Add new env vars to `.env.example` with comments
- [ ] Add `getTTSApiKey()` helper in `router.ts` (mirror `getSttApiKey()` pattern)

### Phase 6: Router integration
- [ ] Add `ttsClients: Map<string, TTSTransport>` and `ttsEnabled: Map<string, boolean>` maps
- [ ] Create TTS client on `start_transcription_stream` (alongside STT client)
- [ ] Set TTS callbacks: `onAudioChunk` → emit `voice_response_delta`, `onDone` → emit `voice_response_done`
- [ ] Add `set_tts_enabled` socket handler to toggle per-session
- [ ] In `processWithOrchestrator()`: after emitting agent result, call `synthesize(output)` only for Orchestrator agent (skip IDE Agent, Browser Agent, and Planner)
- [ ] Capture Orchestrator handoff narration: when `lastAgent` is not Orchestrator, synthesize the Orchestrator's delegation message (not the final agent output)
- [ ] Emit the handoff narration as text too (e.g. `ide_result` with `agent: 'orchestrator'`) so it appears in the chat UI alongside being spoken
- [ ] Add length guard: skip TTS when `output.length > TTS_MAX_LENGTH`
- [ ] Clean up TTS client on `stop_transcription_stream` and `disconnect`
- [ ] Clean up TTS client on `stop_all`

### Phase 6a: Orchestrator prompt update
- [ ] Update Orchestrator agent prompt: instruct it to always produce a brief spoken summary when delegating to another agent (e.g. "Sending this to the IDE agent to refactor the function")
- [ ] Ensure the delegation message is emitted as a separate event before the handoff, so TTS can pick it up

### Phase 7: Frontend — audio playback
- [ ] Create AudioContext (24kHz sample rate) on first user interaction
- [ ] Add `voice_response_delta` listener: decode base64 PCM16 → Float32 → queue AudioBuffer
- [ ] Add `voice_response_done` listener: flush remaining buffer
- [ ] Implement buffer queue with scheduled playback to avoid gaps between chunks
- [ ] Auto-interrupt: stop playback when user starts speaking (microphone active)

### Phase 8: Frontend — UI controls
- [ ] Add TTS toggle button (🔊/🔇) in voice controls area
- [ ] Emit `set_tts_enabled` on toggle
- [ ] Add visual indicator when TTS is playing (pulsing speaker icon or similar)
- [ ] Persist toggle state in local storage

### Phase 9: Remaining TTS transports
- [ ] Create `agents/voice/tts/groq.ts` — POST to `/openai/v1/audio/speech`
- [ ] Create `agents/voice/tts/gemini.ts` — Gemini multimodal with audio output
- [ ] Register both in `tts/index.ts` factory switch
- [ ] Test each transport manually

### Phase 10: Documentation & cleanup
- [ ] Update `AGENTS.md` — add `voice_response_delta`, `voice_response_done`, `set_tts_enabled` to Socket.IO events table
- [ ] Update `AGENTS.md` — update voice directory structure (`stt/`, `tts/`)
- [ ] Update `README.md` — add `TTS_PROVIDER`, `TTS_ENABLED`, `TTS_MAX_LENGTH` to configuration table
- [ ] Update `voice-response.md` — mark plan as completed

## Edge Cases

- Long responses (plans, code): skip TTS or truncate to a summary sentence
- Concurrent responses: queue TTS, don't overlap audio
- User interruption: stop TTS playback when user starts speaking
- Provider errors: log and silently skip TTS (don't block the text response)
- Disconnect: clean up TTS client in the disconnect handler
