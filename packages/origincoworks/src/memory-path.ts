/**
 * Validate memory file paths (gateway + local cache).
 * Mirrors gateway skill id rules: no .., no absolute paths.
 */
export function validateMemoryPath(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/').trim();
  if (!p || p.length > 512) return false;
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  if (p.includes('..')) return false;
  if (p.includes('\0')) return false;
  return true;
}

export function normalizeMemoryPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}
