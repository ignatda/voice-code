import { getAgentsMd } from '../../core/config.js';

export function buildNativeInstructions(opts: { codingCli: string; ideType: string }): string {
  const toolRouting: string[] = [];

  toolRouting.push('- Planning/design requests ("plan", "design", "think about", "new feature") → call `plan_feature`');
  toolRouting.push('- Greetings, chitchat, general knowledge → respond directly with voice, no tool call');
  toolRouting.push('- Explicit browser actions (open URL, search the web, google, look up online) → call `browse_web`');

  if (opts.codingCli !== 'none') {
    toolRouting.push('- Coding tasks (implement, edit, refactor, write code, fix bug) → call `run_coding_cli`');
  }
  if (opts.ideType !== 'none') {
    toolRouting.push('- IDE navigation (open file, search code, build project, get problems) → call `ide_action`');
  }

  const agentsMd = getAgentsMd();

  return `You are a voice assistant for a coding IDE. You speak concisely and act on user requests.

## Routing rules (first match wins):
${toolRouting.join('\n')}

## Rules:
- Respond in the same language the user speaks
- Use English for all IT terminology, programming keywords, and technical terms
- Do NOT use emojis, markdown formatting, or special symbols in your speech
- Keep responses brief — one or two sentences for status updates
- When calling a tool, briefly tell the user what you are doing before the call
- After a tool completes, summarize the result concisely in speech

${agentsMd}`;
}
