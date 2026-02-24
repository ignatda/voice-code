from typing import Dict, Any


class BrowserAgent:
    """Dummy browser agent that only logs prompts."""

    def __init__(self):
        pass

    def process(self, prompt: str) -> Dict[str, Any]:
        print(f"[browser_agent] Received prompt: {prompt}")
        
        return {
            "agent": "browser",
            "status": "dummy",
            "message": "Browser agent is not implemented yet",
            "received_prompt": prompt
        }
