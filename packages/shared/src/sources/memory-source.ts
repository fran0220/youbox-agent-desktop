/**
 * Built-in @memory source (formal `memory` SourceType).
 *
 * Virtual source backed by the gateway user_memory store (sync/tools wired in
 * m6-memory-rw-sync). This module only defines the LoadedSource shape for
 * listing, mentions, and session enablement.
 */

import type { FolderSourceConfig, LoadedSource, SourceGuide } from './types.ts';

/** Canonical slug for [source:memory] / @memory mentions */
export const MEMORY_SOURCE_SLUG = 'memory';

const MEMORY_GUIDE_RAW = `# Memory

Gateway-backed personal memory for this user. Use \`[source:memory]\` to scope
turns to memory read/search/write tools once sync is active.

## Scope

Persistent notes, preferences, and daily logs stored in \`user_memory\` on the
gateway (file paths + markdown content).
`;

function buildMemoryConfig(): FolderSourceConfig {
  return {
    id: 'builtin-memory',
    name: 'Memory',
    slug: MEMORY_SOURCE_SLUG,
    enabled: true,
    provider: 'origincoworks',
    type: 'memory',
    icon: '🧠',
    tagline: 'Personal memory backed by the gateway',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };
}

/**
 * Built-in memory source for a workspace (no on-disk folder).
 */
export function getMemoryBuiltinSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const guide: SourceGuide = {
    raw: MEMORY_GUIDE_RAW,
    scope: 'Persistent user memory on the gateway (user_memory).',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config: buildMemoryConfig(),
    guide,
    isBuiltin: true,
  };
}

export function isMemorySourceSlug(slug: string): boolean {
  return slug === MEMORY_SOURCE_SLUG;
}
