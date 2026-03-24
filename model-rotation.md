# Model Rotation — Multi-Provider LLM & STT

Diversify paid x.ai limits by rotating across free-tier providers on errors.

## Providers

### LLM (Chat Completions)

| Provider | Base URL | Default Model |
|---|---|---|
| xAI | `https://api.x.ai/v1` | `grok-4-1-fast-non-reasoning` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-3-flash-preview` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |

### STT (Voice-to-Text)

| Provider | Protocol | Model |
|---|---|---|
| xAI | WebSocket (Realtime API) | Built-in |
| Groq | REST batch (Whisper) | `whisper-large-v3` |

## Per-Agent Model Map

| Agent | Role | xAI | Gemini | Groq |
|---|---|---|---|---|
| Orchestrator | Fast routing | `grok-4-1-fast-non-reasoning` | `gemini-3.1-flash-lite-preview` | `openai/gpt-oss-20b` |
| Browser | Precise tool calling | `grok-4.20-0309-non-reasoning` | `gemini-3.1-pro-preview` | `openai/gpt-oss-120b` |
| IDE | Coding + tool calling | `grok-4.20-0309-non-reasoning` | `gemini-3.1-pro-preview` | `openai/gpt-oss-120b` |
| Planner | Deep reasoning | `grok-4.20-0309-reasoning` | `gemini-3.1-pro-preview` | `openai/gpt-oss-120b` |

## Environment Variables

```bash
LLM_PROVIDERS=xai,gemini,groq   # comma-separated, first = primary
XAI_API_KEY=...
GEMINI_API_KEY=...
GROQ_API_KEY=...
STT_PROVIDER=xai                # xai or groq
```

## Key Implementation Details

- `core/config.ts` — `PROVIDER_REGISTRY`, `getProviderConfigs()`, `bootstrapPrimaryProvider()`
- `core/providers.ts` — `initPool()`, `resetRotation()`, `rotateProvider()`, `getAgentModel()`
- `router.ts` — retry loop catches 400/404/429/5xx, rotates provider, rebuilds agent graph
- `router.ts` — uses `new Runner().run()` (not `run()`) to avoid SDK singleton provider cache
- `routes/settings.ts` — calls `reinitProvider()` on save for hot-reload without restart
- `agents/voice/` — `VoiceTransport` interface, factory `createVoiceClient(provider, apiKey, sid)`
