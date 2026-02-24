import asyncio
from typing import Dict, Any, Optional

from camel.toolkits import HybridBrowserToolkit
from .tool_executor import ToolExecutorAgent


class BrowserAgent:
    """Browser control agent using ToolExecutorAgent."""
    
    def __init__(self):
        self.toolkit: Optional[HybridBrowserToolkit] = None
        self.executor: Optional[ToolExecutorAgent] = None
        self.is_open = False
    
    def ensure_browser_open(self):
        if not self.is_open:
            self.toolkit = HybridBrowserToolkit(
                headless=False,
                browser_log_to_file=True
            )
            asyncio.run(self.toolkit.browser_open())
            self.executor = ToolExecutorAgent(self.toolkit)
            self.is_open = True
            print("[browser_agent] Browser opened")
    
    def close_browser(self) -> Dict[str, Any]:
        if self.is_open and self.toolkit:
            asyncio.run(self.toolkit.browser_close())
            self.is_open = False
            self.toolkit = None
            self.executor = None
            print("[browser_agent] Browser closed")
            return {"status": "success", "message": "Browser closed"}
        return {"status": "error", "message": "Browser was not open"}
    
    def is_browser_open(self) -> bool:
        return self.is_open
    
    def process(self, prompt: str) -> Dict[str, Any]:
        """Process a voice command for browser control."""
        prompt_lower = prompt.lower()
        
        # Handle close command
        if "close" in prompt_lower and "browser" in prompt_lower:
            return self.close_browser()
        
        # Handle open command - ensure browser is open first
        if "open" in prompt_lower or "go to" in prompt_lower or "navigate" in prompt_lower:
            self.ensure_browser_open()
        
        # Ensure browser is open for any command
        if not self.is_open:
            self.ensure_browser_open()
        
        # Execute the command
        if self.executor:
            result = asyncio.run(self.executor.execute(prompt))
            print(f"[browser_agent] Result: {result}")
            return result
        
        return {"status": "error", "message": "Executor not initialized"}
