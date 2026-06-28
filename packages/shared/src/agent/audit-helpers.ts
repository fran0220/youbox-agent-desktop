/**
 * Build gateway audit payloads for tool lifecycle events (no network I/O).
 */
import type { PermissionMode } from './mode-manager.ts';
import type { PreToolUseCheckResult } from './core/pre-tool-use.ts';

export interface AgentAuditEvent {
  action: string;
  resource_type: string;
  resource_id: string;
}

const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function resourceIdForTool(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash' && typeof input.command === 'string') {
    return input.command;
  }
  if (FILE_WRITE_TOOLS.has(toolName)) {
    const path =
      (typeof input.file_path === 'string' && input.file_path) ||
      (typeof input.notebook_path === 'string' && input.notebook_path) ||
      toolName;
    return path;
  }
  if (toolName.startsWith('mcp__')) {
    return toolName.replace(/^mcp__/, '').replace(/__/g, '/');
  }
  if (toolName.startsWith('api_')) {
    const method = ((input.method as string) || 'GET').toUpperCase();
    const path = (input.path as string) || '';
    return `${method} ${path}`.trim();
  }
  return toolName;
}

function resourceTypeForTool(toolName: string): string {
  if (toolName === 'Bash') return 'bash';
  if (FILE_WRITE_TOOLS.has(toolName)) return 'file_write';
  if (toolName.startsWith('mcp__')) return 'mcp';
  if (toolName.startsWith('api_')) return 'api';
  return 'tool';
}

export function buildPostToolUseAuditEvent(
  toolName: string,
  input: Record<string, unknown> | undefined,
  isError: boolean,
): AgentAuditEvent {
  const base = resourceIdForTool(toolName, input ?? {});
  return {
    action: isError ? 'tool_failure' : 'tool_success',
    resource_type: resourceTypeForTool(toolName),
    resource_id: isError ? `${base}|outcome=failure` : base,
  };
}

export function buildPreToolUseAuditEvent(args: {
  toolName: string;
  input: Record<string, unknown>;
  permissionMode: PermissionMode;
  checkResult: PreToolUseCheckResult;
}): AgentAuditEvent | null {
  const { toolName, input, permissionMode, checkResult } = args;
  const resourceId = resourceIdForTool(toolName, input);
  const resourceType = resourceTypeForTool(toolName);

  if (checkResult.type === 'block') {
    const reason = checkResult.reason?.slice(0, 200) ?? 'blocked';
    return {
      action: 'tool_blocked',
      resource_type: resourceType,
      resource_id: `${resourceId}|denied|${reason}`,
    };
  }

  if (checkResult.type === 'prompt') {
    return {
      action: 'tool_prompt',
      resource_type: resourceType,
      resource_id: resourceId,
    };
  }

  if (checkResult.type === 'allow' || checkResult.type === 'modify') {
    if (permissionMode === 'allow-all') {
      const noteworthy =
        toolName === 'Bash' ||
        FILE_WRITE_TOOLS.has(toolName) ||
        toolName.startsWith('mcp__') ||
        toolName.startsWith('api_');
      if (noteworthy) {
        return {
          action: 'tool_allow_all_auto',
          resource_type: resourceType,
          resource_id: resourceId,
        };
      }
    }
    if (permissionMode !== 'safe') {
      const noteworthy =
        toolName === 'Bash' ||
        FILE_WRITE_TOOLS.has(toolName) ||
        toolName.startsWith('mcp__');
      if (noteworthy) {
        return {
          action: 'tool_execute',
          resource_type: resourceType,
          resource_id: resourceId,
        };
      }
    }
  }

  return null;
}
