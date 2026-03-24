# Model Rotation — Multi-Provider Failover

Diversify paid x.ai limits by rotating across free-tier LLM and STT providers on 429 errors.

## Providers

### LLM (Chat Completions)

| Provider | Base URL | Free tier | Model |
|---|---|---|---|
| xAI (Grok) | `https://api.x.ai/v1` | $25/month credits | `grok-4-1-fast-non-reasoning` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | 15 RPM | `gemini-2.5-flash` |
| Groq | `https://api.groq.com/openai/v1` | ~30 RPM | `llama-3.3-70b-versatile` |

All three expose OpenAI-compatible endpoints → work with `OpenAIProvider` + `useResponses: false`.

### Voice STT (Phase 2, future)

| Provider | Protocol | Free tier |
|---|---|---|
| xAI Realtime | WebSocket (current) | Included in credits |
| Google Cloud STT | gRPC streaming | 60 min/month |
| Groq Whisper | REST batch | Free tier |

Voice rotation requires a provider abstraction over different protocols — out of scope for Phase 1.

---

## Architecture

### Current flow (single provider)

```
ensureProvider()  →  setDefaultModelProvider(OpenAIProvider)  →  all agents use it
getXAIConfig()    →  { apiKey, baseURL, model }               →  each Agent({ model })
```

Problem: `setDefaultModelProvider` is global and set once. The SDK's `run()` uses it for every LLM call. A 429 from Grok kills the entire run.

### New flow (rotation on 429)

```
                    ┌─────────────────────────────┐
                    │     ProviderPool             │
                    │  [xai, gemini, groq]         │
                    │                              │
run() fails 429 →  │  next() → OpenAIProvider #2  │  → retry run()
                    │  next() → OpenAIProvider #3  │  → retry run()
                    └─────────────────────────────┘
```

Key insight: we can't hotswap mid-`run()` because `setDefaultModelProvider` is global and the SDK doesn't expose per-request provider override. Instead, we **catch 429 at the `run()` call site, rotate the global provider, and retry the full `run()`**.

This works because:
- `run()` is called once per user message in `router.ts`
- The SDK session preserves conversation history, so a retry continues naturally
- Agent graph is rebuilt per request anyway (`buildAgentGraph()`)

---

## Environment Variables — Option B (Explicit Provider List)

Each provider gets its own semantically named API key. The primary provider is determined by order in `LLM_PROVIDERS`, not by `OPENAI_*` vars.

### New `.env.example`

```bash
# ── LLM Provider Rotation ─────────────────────────────────────
# Comma-separated provider list: first = primary, rest = fallbacks on 429
# Available: xai, gemini, groq
LLM_PROVIDERS=xai,gemini,groq

# Provider API keys (leave empty to skip that provider)
XAI_API_KEY=your-xai-api-key-here
GEMINI_API_KEY=
GROQ_API_KEY=

# ── SDK compatibility ─────────────────────────────────────────
# These are derived automatically from the primary provider above.
# The OpenAI Agents SDK reads OPENAI_API_KEY and OPENAI_BASE_URL internally,
# so we set them at startup from the first entry in LLM_PROVIDERS.
# Do NOT set these manually — they are managed by the app.
# OPENAI_API_KEY=  (auto-set)
# OPENAI_BASE_URL= (auto-set)

# Disable OpenAI Agents SDK tracing (incompatible with non-OpenAI providers)
OPENAI_AGENTS_DISABLE_TRACING=1
```

### Provider Registry (hardcoded in code)

Each provider has a fixed base URL and default model. Only the API key comes from env:

```typescript
const PROVIDER_REGISTRY: Record<string, { baseURL: string; defaultModel: string }> = {
  xai:    { baseURL: 'https://api.x.ai/v1',                                        defaultModel: 'grok-4-1-fast-non-reasoning' },
  gemini: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',     defaultModel: 'gemini-2.5-flash' },
  groq:   { baseURL: 'https://api.groq.com/openai/v1',                             defaultModel: 'llama-3.3-70b-versatile' },
};
```

### SDK Bootstrap

At startup (in `core/config.ts` or `index.ts`), after loading `.env`:

1. Read `LLM_PROVIDERS` → parse first entry → look up its API key env var
2. Set `process.env.OPENAI_API_KEY` and `process.env.OPENAI_BASE_URL` from that provider's config
3. SDK auto-configures from these vars as usual

This way the SDK never knows about rotation — it just sees `OPENAI_*` vars that happen to point at whichever provider is currently primary.

---

## Implementation Plan

### Phase 1: LLM Provider Rotation

#### 1. New env vars

Replace current `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` with:

```bash
LLM_PROVIDERS=xai,gemini,groq
XAI_API_KEY=...
GEMINI_API_KEY=
GROQ_API_KEY=
```

#### 2. `core/config.ts` — Provider registry + config builder

Add:
- `PROVIDER_REGISTRY` — hardcoded base URLs and default models per provider name
- `getProviderConfigs()` — reads `LLM_PROVIDERS` + `*_API_KEY` env vars, returns ordered list of `{ name, apiKey, baseURL, model }`, skipping entries with missing keys
- `bootstrapPrimaryProvider()` — sets `process.env.OPENAI_API_KEY` and `process.env.OPENAI_BASE_URL` from the first provider in the list (called once at startup before SDK init)
- Keep `getXAIConfig()` working — it now reads from the bootstrapped `OPENAI_*` vars (no change needed in its implementation)

#### 3. `core/providers.ts` — ProviderPool (new file)

```
core/
├── providers.ts   # NEW — ProviderPool class
├── config.ts      # Updated with registry + getProviderConfigs()
└── ...
```

Responsibilities:
- Build provider list from `getProviderConfigs()`
- `current()` → returns `{ name, provider: OpenAIProvider, model: string }`
- `rotate()` → advances to next provider, calls `setDefaultModelProvider()`, sets `process.env.OPENAI_*`, returns new config. Returns `false` if exhausted.
- `reset()` → resets rotation index (call at start of each request)

Provider order: determined by `LLM_PROVIDERS` env var.

#### 4. Update `agents/provider.ts`

Replace `ensureProvider()` with pool-aware version:

- `ensureProvider()` → initializes pool, sets first provider as default
- `rotateProvider()` → calls `pool.rotate()`, returns `false` if exhausted
- `resetRotation()` → resets pool for new request
- `getCurrentModel()` → returns current provider's model name

#### 5. Update agent model references

Change: `model: getXAIConfig().model` → `model: getCurrentModel()`

Affected files:
- `agents/orchestrator/index.ts`
- `agents/browser/index.ts`
- `agents/ide/index.ts`
- `agents/planner/index.ts`
- `agents/extensions/example/index.ts`

Since `buildAgentGraph()` is called per request, agents always get the current model.

#### 6. Retry loop in `router.ts`

Wrap the `run()` call in `processWithOrchestrator()` with retry logic:

```
resetRotation()

while (true) {
  try {
    result = await run(orchestrator, input, { signal, session, context, maxTurns: 30 })
    break
  } catch (error) {
    if (is429(error) && rotateProvider()) {
      // Rebuild agent graph with new model
      graph = await buildAgentGraph(opts)
      logger.warn(`[run] 429 from provider, rotated to ${getCurrentModel()}`)
      continue
    }
    throw error  // Not a 429, or all providers exhausted
  }
}
```

429 detection: check `error.status === 429` or `error.message` contains "rate limit" / "429".

#### 7. Update `router.ts` context

`AppContext.config` currently comes from `getXAIConfig()`. Update to reflect current provider:

```typescript
const context: AppContext = {
  config: { apiKey: pool.current().apiKey, baseURL: pool.current().baseURL, model: pool.current().model },
  ...
};
```

Or simplify: keep `getXAIConfig()` since it reads from `process.env.OPENAI_*` which gets updated on rotation.

#### 8. Update `index.ts` bootstrap

Call `bootstrapPrimaryProvider()` after `loadEnv()` but before any agent imports:

```typescript
loadEnv();
bootstrapPrimaryProvider();  // sets OPENAI_* from first LLM_PROVIDERS entry
// ... dynamic imports of agents ...
```

#### 9. UI indicator (optional)

Emit a socket event when rotation happens so the frontend can show which provider is active:

```typescript
io.to(sid).emit('provider_rotated', { provider: 'gemini', reason: '429' });
```

---

## Migration from Current Env Vars

| Old | New | Notes |
|---|---|---|
| `OPENAI_API_KEY=xai-key` | `XAI_API_KEY=xai-key` | Renamed to semantic name |
| `OPENAI_BASE_URL=https://api.x.ai/v1` | (removed) | Hardcoded in registry |
| `OPENAI_MODEL=grok-4-1-fast-non-reasoning` | (removed) | Hardcoded in registry |
| — | `LLM_PROVIDERS=xai,gemini,groq` | New: provider order |
| — | `GEMINI_API_KEY=` | New: optional |
| — | `GROQ_API_KEY=` | New: optional |
| `OPENAI_AGENTS_DISABLE_TRACING=1` | `OPENAI_AGENTS_DISABLE_TRACING=1` | Unchanged |

`LLM_PROVIDERS` and at least one `*_API_KEY` are required. The Settings UI enforces this — it forces the settings window open when critical config is missing.

---

## File Changes Summary

| File | Change |
|---|---|
| `.env.example` | New provider vars, remove `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL` |
| `core/config.ts` | Add `PROVIDER_REGISTRY`, `getProviderConfigs()`, `bootstrapPrimaryProvider()` |
| `core/providers.ts` | **New** — `ProviderPool` class |
| `core/index.ts` | Re-export new symbols |
| `agents/provider.ts` | Pool-aware `ensureProvider()`, add `rotateProvider()`, `resetRotation()`, `getCurrentModel()` |
| `agents/orchestrator/index.ts` | `model: getCurrentModel()` |
| `agents/browser/index.ts` | `model: getCurrentModel()` |
| `agents/ide/index.ts` | `model: getCurrentModel()` |
| `agents/planner/index.ts` | `model: getCurrentModel()` |
| `agents/extensions/example/index.ts` | `model: getCurrentModel()` |
| `router.ts` | Retry loop with 429 detection + rotation |
| `index.ts` | Call `bootstrapPrimaryProvider()` at startup |
| `routes/settings.ts` | Update settings UI to show/edit new env vars |

---

## Edge Cases

1. **All providers exhausted** — throw the last error, emit to UI. User sees "All providers rate-limited, try again later."
2. **Different tool-calling quality** — Gemini and Groq may handle complex multi-tool sequences worse than Grok. Accept this as a tradeoff for availability.
3. **Model mismatch in session history** — the SDK session stores messages. Switching models mid-conversation is fine for chat completions (all providers accept the same message format).
4. **Concurrent requests** — `setDefaultModelProvider` is global. If two requests race, one might use the other's provider. This is acceptable — both providers work, and rotation is best-effort.
5. **Provider comes back** — rotation resets per request (`resetRotation()`), so the primary provider is always tried first.
6. **Voice client** — reads `XAI_API_KEY` (was `OPENAI_API_KEY`) for the Realtime WebSocket. Needs update in `router.ts` where the key is read.

---

## Phase 2: Voice STT — xAI Realtime (current, refactor)

Refactor the existing `XAIVoiceClient` into the new transport abstraction without changing behavior.

### New env var

```bash
STT_PROVIDER=xai   # xai (default), groq (Phase 3)
```

### Backend: `agents/voice/` package restructure

Current state — everything is in one file:

```
agents/voice/
└── index.ts        # XAIVoiceClient (WebSocket + PCM16 + VAD)
```

New structure:

```
agents/voice/
├── index.ts            # Re-exports, factory: createVoiceClient(provider)
├── types.ts            # VoiceTransport interface
├── transports/
│   ├── xai.ts          # XAITransport — WebSocket streaming (moved from current index.ts)
│   └── groq.ts         # Phase 3
└── vad.ts              # VAD utilities (shared, extracted if needed)
```

### `VoiceTransport` interface

```typescript
// agents/voice/types.ts

export interface VoiceTransport {
  /** Connect to the STT service */
  connect(): Promise<void>;
  /** Send a PCM16 audio chunk (base64-encoded) */
  sendAudio(base64: string): void;
  /** Signal end of utterance (for providers that need explicit commit) */
  commitAudio(): void;
  /** Disconnect and clean up */
  close(): void;
  /** Register event callbacks */
  setCallbacks(
    onTranscription: (transcript: string) => void,
    onStatus: (status: string) => void,
    onError: (error: string) => void,
  ): void;
  /** Connection state */
  isConnected(): boolean;
}
```

### `createVoiceClient()` factory

```typescript
// agents/voice/index.ts

export function createVoiceClient(provider: string, apiKey: string, sid: string): VoiceTransport {
  switch (provider) {
    case 'xai':    return new XAITransport(apiKey, sid);
    case 'groq':   return new GroqTransport(apiKey, sid);  // Phase 3
    default:       return new XAITransport(apiKey, sid);
  }
}
```

### `router.ts` changes

```typescript
// Before:
const xaiClient = new XAIVoiceClient(XAI_API_KEY, sid);

// After:
const sttProvider = process.env.STT_PROVIDER || 'xai';
const sttApiKey = getProviderApiKey(sttProvider);  // reads XAI_API_KEY or GROQ_API_KEY
const voiceClient = createVoiceClient(sttProvider, sttApiKey, sid);
```

### Frontend: no changes in Phase 2

The frontend audio pipeline stays the same:
- `AudioWorkletProcessor` captures PCM16 at 24kHz mono
- Sends raw `audio_chunk` events via Socket.IO
- Backend handles all STT provider differences

The frontend doesn't know or care which STT provider the backend uses. The Socket.IO events (`audio_chunk`, `commit_audio`, `transcription_update`) are the abstraction boundary.

### Frontend changes (future, if needed)

If a future provider requires a different audio format (e.g. Opus, different sample rate), we'd add a frontend audio transport layer:

```
frontend/src/audio/
├── index.ts            # Factory: createAudioCapture(config)
├── types.ts            # AudioTransport interface
├── transports/
│   ├── pcm16.ts        # Current: PCM16 24kHz via AudioWorklet (for xAI, Groq)
│   └── opus.ts         # Future: Opus encoding (for providers that prefer it)
└── worklets/
    └── pcm16-processor.js  # Moved from public/AudioProcessorWorklet.js
```

But for Phase 2 and 3, all providers accept PCM16 — so no frontend changes needed.

---

## Phase 3: Voice STT — Groq Whisper (batch)

Add Groq Whisper as an alternative STT provider. Free tier, REST-based, slight latency tradeoff.

### How it differs from xAI

| | xAI Realtime | Groq Whisper |
|---|---|---|
| Protocol | WebSocket streaming | REST batch |
| Latency | Real-time (~100ms) | Batch (~300ms-1s per chunk) |
| VAD | Server-side (built-in) | Client-side (we must detect silence) |
| Audio format | PCM16 base64 over WS | File upload (WAV/PCM) |
| Free tier | Included in credits | Free (~30 RPM) |

### Key challenge: VAD + buffering

xAI Realtime has server-side VAD — it detects speech start/stop and transcribes automatically. Groq Whisper is batch — we send a complete audio file and get text back.

We need client-side VAD to:
1. Buffer audio chunks while user is speaking
2. Detect silence → send buffered audio to Groq as one request
3. Return transcription

### `GroqTransport` implementation

```typescript
// agents/voice/transports/groq.ts

export class GroqTransport implements VoiceTransport {
  private buffer: Buffer[] = [];
  private silenceTimer: NodeJS.Timeout | null = null;
  private speaking = false;

  sendAudio(base64: string): void {
    const chunk = Buffer.from(base64, 'base64');
    this.buffer.push(chunk);

    // Simple energy-based VAD
    if (hasVoiceActivity(chunk)) {
      this.speaking = true;
      this.resetSilenceTimer();
    }
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.flushBuffer(), 1000); // 1s silence = end of utterance
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;
    const audio = Buffer.concat(this.buffer);
    this.buffer = [];
    this.speaking = false;

    // Send to Groq Whisper API
    const transcript = await this.transcribe(audio);
    if (transcript) this.onTranscription?.(transcript);
  }

  private async transcribe(pcm16: Buffer): Promise<string> {
    // POST to https://api.groq.com/openai/v1/audio/transcriptions
    // with WAV-wrapped PCM16 audio
    // model: whisper-large-v3
  }

  commitAudio(): void {
    // Manual commit — flush immediately
    this.flushBuffer();
  }
}
```

### Backend file changes

```
agents/voice/transports/
├── xai.ts      # Existing (from Phase 2)
└── groq.ts     # NEW — GroqTransport with client-side VAD + batch REST
```

### Frontend: no changes

Groq accepts PCM16 — same format the frontend already sends. The backend buffers and batches it.

---

---

## UI: API Key Help Tooltips

Add a "?" icon next to each `*_API_KEY` field in the Settings page. Clicking/hovering shows a short guide on how to get the key.

### Help text per provider

```
XAI_API_KEY:
  1. Go to console.x.ai
  2. Sign up or log in
  3. Navigate to API Keys → Create new key
  4. Free credits included with new accounts

GEMINI_API_KEY:
  1. Go to aistudio.google.com
  2. Sign in with Google account
  3. Click "Get API key" → Create key
  4. Free tier: 15 requests/minute

GROQ_API_KEY:
  1. Go to console.groq.com
  2. Sign up or log in
  3. Navigate to API Keys → Create
  4. Free tier: ~30 requests/minute
```

### Component: `HelpTooltip`

Small reusable component — "?" icon that shows a popover/tooltip on click:

```
frontend/src/components/HelpTooltip.jsx   # NEW
```

```jsx
// Usage in Settings.jsx:
<label>
  xAI API Key <HelpTooltip text="1. Go to console.x.ai ..." link="https://console.x.ai" />
  <input type="password" ... />
</label>
```

### Settings.jsx changes

- Replace single `API Key` field with three separate fields: `XAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`
- Add `LLM_PROVIDERS` field (text input or drag-to-reorder list)
- Add `STT_PROVIDER` dropdown (Phase 2)
- Each API key field gets a `<HelpTooltip>` with provider-specific registration guide + link
- Remove `Base URL` field (now hardcoded per provider in registry)

---

## Per-Agent Model Selection

Each agent defines its preferred model per provider. The rotation picks the provider, the agent picks the model on that provider.

```typescript
// Example: agents/orchestrator/index.ts
const MODELS: Record<string, string> = {
  xai:    'grok-4-0724-fast',
  gemini: 'gemini-2.5-flash',
  groq:   'llama-3.3-70b-specdec',
};
// ...
model: getAgentModel(MODELS),
```

### Model assignments

| Agent | Role | xAI | Gemini | Groq |
|---|---|---|---|---|
| Orchestrator | Fast routing | `grok-4-1-fast-non-reasoning` | `gemini-2.5-flash` | `openai/gpt-oss-20b` |
| Browser | Precise tool calling | `grok-4.20-0309-non-reasoning` | `gemini-2.5-pro` | `openai/gpt-oss-120b` |
| IDE | Coding + tool calling | `grok-4.20-0309-non-reasoning` | `gemini-2.5-pro` | `openai/gpt-oss-120b` |
| Planner | Deep reasoning | `grok-4.20-0309-reasoning` | `gemini-2.5-pro` | `openai/gpt-oss-120b` |
| Extensions | Default | (registry default) | (registry default) | (registry default) |

Design: `getAgentModel(agentModels?)` in `core/providers.ts` — looks up current provider name in the agent's map, falls back to registry default if no override.

---

## Phase Summary

| Phase | Scope | Env vars | Frontend changes | Status |
|---|---|---|---|---|
| **Phase 1** | LLM provider rotation (xAI → Gemini → Groq) on 429 | `LLM_PROVIDERS`, `XAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` | Settings UI + HelpTooltip | ✅ Done |
| **Phase 2** | Refactor voice into transport abstraction, xAI stays default | `STT_PROVIDER` | None | ✅ Done |
| **Phase 3** | Add Groq Whisper STT with client-side VAD | `GROQ_API_KEY` (reused) | None | ✅ Done |
| **Future** | Google Cloud STT (gRPC streaming), frontend audio transports | `GOOGLE_STT_API_KEY` | If needed for Opus/format changes |  |
