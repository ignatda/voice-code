from typing import Dict, Any


class IDEAgent:
    """Dummy IDE agent that only logs prompts."""

    def __init__(self):
        pass

    def process(self, prompt: str) -> Dict[str, Any]:
        print(f"[ide_agent] Received prompt: {prompt}")
        
        return {
            "agent": "ide",
            "status": "dummy",
            "message": "IDE agent is not implemented yet",
            "received_prompt": prompt
        }
