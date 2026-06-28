/**
 * Session-scoped memory destructive confirmation (delete / clear).
 * Uses the same permission_request / respondToPermission flow as tool gating.
 */

const MEMORY_DESTRUCTIVE_TOOLS = new Set(['mcp__memory__memory_delete', 'mcp__memory__memory_clear']);

export type MemoryDestructiveSessionHost = {
  requestMemoryDestructiveConfirmation(
    sessionId: string,
    action: 'delete' | 'clear',
    detail: string,
  ): Promise<boolean>;
};

export function isMemoryDestructiveTool(toolName: string): boolean {
  return MEMORY_DESTRUCTIVE_TOOLS.has(toolName);
}

export function createMemoryDestructiveConfirmHandler(
  sessionManager: MemoryDestructiveSessionHost,
  sessionId: string,
): (action: 'delete' | 'clear', detail: string) => Promise<boolean> {
  return (action, detail) => sessionManager.requestMemoryDestructiveConfirmation(sessionId, action, detail);
}
