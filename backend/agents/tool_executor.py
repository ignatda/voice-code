import os
from typing import Dict, Any

from camel.agents import ChatAgent
from camel.agents.chat_agent import AsyncStreamingChatAgentResponse
from camel.models import ModelFactory
from camel.types import ModelPlatformType

XAI_API_KEY = os.getenv("OPENAI_API_KEY")

GROK_MODEL_CONFIG = {
    "model_platform": ModelPlatformType.OPENAI_COMPATIBLE_MODEL,
    "model_type": "grok-3-mini",
    "url": "https://api.x.ai/v1",
    "api_key": XAI_API_KEY,
}


class ToolExecutorAgent:
    """Translates natural language prompts into tool calls and executes them."""
    
    def __init__(self, toolkit):
        self.model = ModelFactory.create(**GROK_MODEL_CONFIG)
        self.toolkit = toolkit
        self.agent = ChatAgent(
            model=self.model,
            tools=self.toolkit.get_tools()
        )
    
    async def execute(self, prompt: str) -> Dict[str, Any]:
        try:
            response = await self.agent.astep(prompt)
            if isinstance(response, AsyncStreamingChatAgentResponse):
                response = response._get_final_response()
            return {
                "status": "success",
                "result": response.msgs[0].content
            }
        except Exception as e:
            return {
                "status": "error",
                "error": str(e)
            }
