# Feature: Piped Orchestrator Streaming

Status: draft

Related: [orchestrator-native](orchestrator-native.md)

Use SDK streaming (`{ stream: true }`) in piped mode to speak the orchestrator's status message BEFORE the sub-agent executes, and speak a summary AFTER.

## Current Behavior

`Runner.run()` executes synchronously — orchestrator → handoff → sub-agent → result. The orchestrator's narration ("Let me search the web...") is only available after the entire chain completes.

## Desired Behavior

```
User speaks → STT → Orchestrator streams → speaks "Let me search for that" (immediate)
  → Handoff to Browser Agent (user hears status while waiting)
  → Browser Agent completes → result displayed in UI
  → Orchestrator summary spoken via TTS
```

## Technical Approach

Use `run(agent, input, { stream: true })` and listen to stream events:

1. `run_item_stream_event` with `name: 'message_output_created'` — orchestrator's text before handoff → speak via TTS immediately
2. `agent_updated_stream_event` — agent switched (handoff occurred) → emit status to UI
3. `run_item_stream_event` with `name: 'handoff_occurred'` — handoff completed
4. After `stream.completed` — extract final output, speak summary via TTS

Key SDK streaming events:
- `raw_model_stream_event` — token-by-token text deltas
- `run_item_stream_event` — SDK items (messages, tool calls, handoffs)
- `agent_updated_stream_event` — agent switches

## Implementation Plan

- [ ] **Step 1: Switch `processWithOrchestrator` to streaming mode**
  - [ ] Replace `new Runner().run(...)` with `run(agent, input, { stream: true })`
  - [ ] Iterate stream events with `for await (const event of result)`
  - [ ] Await `result.completed` after loop

- [ ] **Step 2: Intercept orchestrator narration before handoff**
  - [ ] On `run_item_stream_event` with `name: 'message_output_created'` where agent is Orchestrator
  - [ ] Extract text from the message item
  - [ ] Call `speakIfEnabled()` immediately (non-blocking)
  - [ ] Emit `ide_result` with orchestrator narration to UI

- [ ] **Step 3: Emit agent switch status to UI**
  - [ ] On `agent_updated_stream_event` — emit status showing which agent is now active
  - [ ] On `run_item_stream_event` with `name: 'handoff_occurred'` — emit handoff info

- [ ] **Step 4: Handle final output and summary**
  - [ ] After `stream.completed`, extract `result.finalOutput`
  - [ ] Emit sub-agent result to UI (same as current behavior)
  - [ ] Speak summary via TTS (the sub-agent's final output, truncated)

- [ ] **Step 5: Preserve existing error handling and provider rotation**
  - [ ] Wrap streaming in try/catch with same `isRetryable` + `rotateProvider` logic
  - [ ] Ensure abort signal still works for stop commands

## Notes

- Native orchestrator already handles this naturally (xAI Realtime speaks before and after tool calls)
- This only affects piped mode
- The `{ stream: true }` option works with Chat Completions mode (`useResponses: false`)
- `stream.completed` must be awaited to ensure all output is flushed
