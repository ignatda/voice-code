import asyncio
import threading
from typing import Dict, Any, Optional

from camel.toolkits import HybridBrowserToolkit
from .tool_executor import ToolExecutorAgent


class BrowserAgent:
    """Browser control agent using ToolExecutorAgent with background thread."""
    
    def __init__(self):
        self.toolkit: Optional[HybridBrowserToolkit] = None
        self.executor: Optional[ToolExecutorAgent] = None
        self.is_open = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
    
    def _run_event_loop(self):
        """Run event loop in background thread."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()
    
    def _ensure_thread_started(self):
        """Ensure background thread is running."""
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run_event_loop, daemon=True)
            self._thread.start()
            # Wait for loop to be ready
            import time
            while self._loop is None:
                time.sleep(0.1)
    
    def _run_async(self, coro):
        """Run coroutine in background thread and wait for result."""
        self._ensure_thread_started()
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result()
    
    def ensure_browser_open(self):
        if not self.is_open:
            self.toolkit = HybridBrowserToolkit(
                headless=False,
                browser_log_to_file=True
            )
            self._run_async(self.toolkit.browser_open())
            self.executor = ToolExecutorAgent(self.toolkit)
            self.is_open = True
            print("[browser_agent] Browser opened")
    
    def close_browser(self) -> Dict[str, Any]:
        if self.is_open and self.toolkit:
            self._run_async(self.toolkit.browser_close())
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
            result = self._run_async(self.executor.execute(prompt))
            print(f"[browser_agent] Result: {result}")
            return result
        
        return {"status": "error", "message": "Executor not initialized"}
