# Feature: Piped Orchestrator Streaming Improvements

## Summary

Improve the piped orchestrator mode so that:
1. The orchestrator's status message ("Let me search the web...") is spoken BEFORE the sub-agent executes, not after
2. The orchestrator provides a voice summary of the sub-agent's result after execution completes

## Current Behavior

The SDK `Runner.run()` executes the full chain synchronously — orchestrator → handoff → sub-agent → result. The orchestrator narration is only extractable after the entire run completes, so TTS speaks it after the browser/IDE has already finished.

## Desired Behavior

```
User speaks → STT → Orchestrator decides → speaks "Let me search for that" (immediate)
  → Browser Agent executes (user hears status while waiting)
  → Orchestrator summarizes result → speaks summary
```

## Implementation Ideas

- [ ] Use SDK streaming/hooks to intercept orchestrator output before handoff
- [ ] Or split the run into two phases: orchestrator routing (with TTS) → sub-agent execution → summary
- [ ] Add a post-execution summary step: run orchestrator again with the sub-agent result to generate a spoken summary

## Notes

- Native orchestrator already handles this naturally (xAI speaks before and after tool calls)
- This is a pre-existing limitation, not a regression
