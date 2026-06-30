/**
 * Browser-safe path display helpers. Intentionally free of Node built-ins (os, path, fs)
 * so renderer/UI code can import it without dragging the Node-only config subgraph
 * (and @anthropic-ai/claude-agent-sdk) into the browser bundle. Node-only resolution
 * helpers live in ./paths.ts, which re-exports these.
 */

/** Basename of the default per-user data directory (without ~). */
export const DEFAULT_DATA_DIR_NAME = '.originai';

/** Legacy data directory basename; read fallback when ~/.originai does not exist. */
export const LEGACY_DATA_DIR_NAME = '.origincoworks-next';

/**
 * Strip the data-dir workspace/session prefix from an absolute path for compact UI display.
 * e.g. "/Users/.../.originai/workspaces/{id}/sessions/{id}/plans/foo.md" → "plans/foo.md"
 */
export function stripCraftDataDirWorkspacePath(
  rawPath: string,
  dataDirName: string = DEFAULT_DATA_DIR_NAME
): string {
  if (!rawPath) return rawPath;
  const normalized = rawPath.replace(/\\/g, '/');
  const escapedDir = dataDirName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefixPattern = new RegExp(
    `^.*${escapedDir}/workspaces/[^/]+/(?:sessions/[^/]+/)?`
  );
  return normalized.replace(prefixPattern, '');
}