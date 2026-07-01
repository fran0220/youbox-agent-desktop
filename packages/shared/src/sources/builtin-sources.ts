/**
 * Built-in Sources
 *
 * System-level sources that are always available in every workspace.
 * These sources are not shown in the sources list UI but are available
 * for the agent to use.
 *
 * NOTE: built-in docs MCP is disabled in the YouBox fork unless
 * YOUBOX_AGENT_DOCS_MCP_URL is explicitly configured. This file is kept for
 * backwards compatibility but returns empty results.
 */

import type { LoadedSource, FolderSourceConfig } from './types.ts';

/**
 * Get all built-in sources for a workspace.
 *
 * Currently returns an empty array; YouBox does not auto-connect to Craft docs.
 *
 * @param _workspaceId - The workspace ID (unused)
 * @param _workspaceRootPath - Absolute path to workspace root folder (unused)
 * @returns Empty array (no built-in sources)
 */
export function getBuiltinSources(_workspaceId: string, _workspaceRootPath: string): LoadedSource[] {
  return [];
}

/**
 * Get the optional built-in YouBox Agent docs source placeholder.
 *
 * @deprecated docs MCP is disabled by default. This function is kept for
 * upstream compatibility but returns a disabled placeholder.
 */
export function getDocsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  // Return a placeholder - this shouldn't be called anymore
  const placeholderConfig: FolderSourceConfig = {
    id: 'builtin-youbox-agent-docs',
    name: 'YouBox Agent Docs',
    slug: 'youbox-agent-docs',
    enabled: false,
    provider: 'mintlify',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: process.env.YOUBOX_AGENT_DOCS_MCP_URL || 'https://api.you-box.com/docs/agent/mcp',
      authType: 'none',
    },
    tagline: 'Search YouBox Agent documentation and source setup guides',
    icon: '📚',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config: placeholderConfig,
    guide: { raw: '' },
    isBuiltin: true,
  };
}

/**
 * Check if a source slug is a built-in source.
 *
 * Returns false - docs MCP is not a built-in source in the YouBox fork.
 *
 * @param _slug - Source slug to check (unused)
 * @returns false (no built-in sources)
 */
export function isBuiltinSource(_slug: string): boolean {
  return false;
}
