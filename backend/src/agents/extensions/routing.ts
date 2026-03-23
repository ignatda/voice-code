import type { InstructionParts } from '../orchestrator/instructions.js';

// Extra routing rules injected into the orchestrator prompt.
// Only active when extensions are enabled via EXTENSIONS env var.
const extensionRouting: Partial<InstructionParts> = {
  extraRouting: '- Extension/test requests ("test extension", "run example") → hand off to the appropriate **Extension Agent**',
};

export default extensionRouting;
