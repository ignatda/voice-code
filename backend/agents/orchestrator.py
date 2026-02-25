import json
import os
from typing import Dict, Any

import openai

XAI_API_KEY = os.getenv("OPENAI_API_KEY")

ORCHESTRATOR_SYSTEM_PROMPT = """You are an Orchestrator Agent for a voice-controlled IDE.

Your role is to analyze transcribed user speech and determine which specialized agents should respond.

Available agents:
1. **browser** - Controls web browser (open pages, search, navigate, read content, watch videos, control video playback, scroll, click, close tabs, find elements on page)
2. **ide** - Controls IDE (IntelliJ IDEA) - create files, edit code, run commands, manage projects

Analyze the user's transcribed speech and create specific prompts for the appropriate agents.

Output format (JSON):
{
  "original_text": "<the transcribed text>",
  "prompts": [
    {
      "agent": "browser" | "ide",
      "prompt": "<specific action to perform>"
    }
  ]
}

Rules:
- If the user mentions browsing, searching, opening a website, reading web content, watching videos, video playback, scrolling, clicking, closing tabs, or any web/navigation action → include browser agent
- If the user mentions coding, files, IDE, running code, or project management → include ide agent
- If the speech is just conversational/greeting → prompts array can be empty
- Always preserve the original transcribed text exactly
- Make prompts specific and actionable
- Use English for prompts regardless of the input language
- Output only valid JSON, no additional text
- NEVER return empty prompts for valid commands - always include at least one agent if the user is asking to do something
- Common commands to recognize:
  - "scroll" / "scroll down" / "scroll up" → browser agent
  - "open" / "go to" / "navigate to" → browser agent
  - "search" / "find" → browser agent
  - "click" / "press" → browser agent
  - "close" / "close the browser" → browser agent
"""


class OrchestratorAgent:
    def __init__(self):
        self.client = openai.OpenAI(
            api_key=XAI_API_KEY,
            base_url="https://api.x.ai/v1"
        )
        self.model = "grok-4-1-fast-non-reasoning"

    def process(self, transcription: str) -> Dict[str, Any]:
        # Skip incomplete transcriptions (ending with ellipsis or very short fragments)
        if not transcription or len(transcription.strip()) < 3:
            return {
                "original_text": transcription,
                "prompts": []
            }
        
        # Skip incomplete commands (ending with "..." or trailing off)
        if transcription.strip().endswith('...'):
            return {
                "original_text": transcription,
                "prompts": []
            }
        
        # Skip if it looks like a partial word (ends with partial word pattern)
        stripped = transcription.strip()
        if stripped and stripped[-1] == '-' and len(stripped) < 10:
            return {
                "original_text": transcription,
                "prompts": []
            }

        translation_prompt = f"""Translate the following text to English. If it's already in English, return it as-is. 
Just output the translated text, nothing else:

{transcription}"""

        try:
            translation_response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a translator. Translate any language to English."},
                    {"role": "user", "content": translation_prompt}
                ],
                temperature=0.0,
            )
            translated_text = translation_response.choices[0].message.content.strip()
        except Exception as e:
            print(f"[orchestrator] Translation error: {e}, using original")
            translated_text = transcription

        prompt = f"""Analyze this transcribed speech and output JSON with agent prompts: {translated_text}"""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": ORCHESTRATOR_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.0,
            )

            content = response.choices[0].message.content
            if content is None:
                raise ValueError("Empty response from model")
            result = json.loads(content)

            return {
                "original_text": transcription,
                "prompts": result.get("prompts", [])
            }
        except Exception as e:
            print(f"[orchestrator] Error: {e}")
            return {
                "original_text": transcription,
                "prompts": []
            }
