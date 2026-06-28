/**
 * Checksum-diff read-through cache: gateway user_memory ↔ workspace memory-cache/
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, normalize } from 'path';
import { GatewayClient } from './gateway-client.ts';
import { contentChecksum } from './checksum.ts';
import type { MemoryManifestEntry, MemoryPullEntry, MemoryPushEntry } from './memory-types.ts';
import { normalizeMemoryPath, validateMemoryPath } from './memory-path.ts';

const SYNC_STATE_FILE = '.gateway-memory-sync.json';
const CACHE_DIR_NAME = 'memory-cache';

export type MemorySyncState = {
  lastManifestChecksum: string;
  serverTime?: string;
};

export type MemorySyncResult = {
  pulled: number;
  pushed: number;
  skipped: boolean;
  cacheInvalidated: boolean;
};

function syncStatePath(workspaceRoot: string): string {
  return join(workspaceRoot, SYNC_STATE_FILE);
}

function cacheRoot(workspaceRoot: string): string {
  return join(workspaceRoot, CACHE_DIR_NAME);
}

export function readMemorySyncState(workspaceRoot: string): MemorySyncState {
  const path = syncStatePath(workspaceRoot);
  if (!existsSync(path)) {
    return { lastManifestChecksum: '' };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as MemorySyncState;
    return {
      lastManifestChecksum: typeof parsed.lastManifestChecksum === 'string' ? parsed.lastManifestChecksum : '',
      serverTime: typeof parsed.serverTime === 'string' ? parsed.serverTime : undefined,
    };
  } catch {
    return { lastManifestChecksum: '' };
  }
}

export function writeMemorySyncState(workspaceRoot: string, state: MemorySyncState): void {
  const path = syncStatePath(workspaceRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function listLocalMemoryFiles(workspaceRoot: string): Array<{ path: string; content: string; checksum: string }> {
  const root = cacheRoot(workspaceRoot);
  if (!existsSync(root)) {
    return [];
  }
  const out: Array<{ path: string; content: string; checksum: string }> = [];

  const walk = (dir: string, prefix: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs, rel);
      } else if (ent.isFile()) {
        const norm = normalizeMemoryPath(rel);
        if (!validateMemoryPath(norm)) continue;
        try {
          const content = readFileSync(abs, 'utf8');
          out.push({ path: norm, content, checksum: contentChecksum(content) });
        } catch {
          // skip unreadable
        }
      }
    }
  };
  walk(root, '');
  return out;
}

export function aggregateManifestChecksum(manifest: MemoryManifestEntry[]): string {
  const sorted = [...manifest].sort((a, b) => a.path.localeCompare(b.path));
  const joined = sorted.map((e) => `${e.path}:${e.checksum}`).join('\n');
  return contentChecksum(joined);
}

export function applyMemoryPullToCache(workspaceRoot: string, pull: MemoryPullEntry[]): number {
  const root = cacheRoot(workspaceRoot);
  mkdirSync(root, { recursive: true });
  let written = 0;
  for (const file of pull) {
    const norm = normalizeMemoryPath(file.path);
    if (!validateMemoryPath(norm)) continue;
    const dest = join(root, norm);
    const destNorm = normalize(dest);
    const rootNorm = normalize(root);
    if (!destNorm.startsWith(rootNorm)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.content ?? '', 'utf8');
    written += 1;
  }
  return written;
}

export function readMemoryFromCache(workspaceRoot: string, filePath: string): string | null {
  const norm = normalizeMemoryPath(filePath);
  if (!validateMemoryPath(norm)) return null;
  const abs = join(cacheRoot(workspaceRoot), norm);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

export function writeMemoryToCache(workspaceRoot: string, filePath: string, content: string): void {
  const norm = normalizeMemoryPath(filePath);
  if (!validateMemoryPath(norm)) {
    throw new Error(`invalid memory path: ${filePath}`);
  }
  const abs = join(cacheRoot(workspaceRoot), norm);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

export function deleteMemoryFromCache(workspaceRoot: string, filePath: string): boolean {
  const norm = normalizeMemoryPath(filePath);
  if (!validateMemoryPath(norm)) return false;
  const abs = join(cacheRoot(workspaceRoot), norm);
  if (!existsSync(abs)) return false;
  rmSync(abs);
  return true;
}

export function listMemoryPathsInCache(workspaceRoot: string): string[] {
  return listLocalMemoryFiles(workspaceRoot).map((f) => f.path);
}

export async function syncGatewayMemoryToWorkspace(options: {
  client: GatewayClient;
  workspaceRoot: string;
  pushPaths?: string[];
}): Promise<MemorySyncResult> {
  const { client, workspaceRoot, pushPaths } = options;
  const localFiles = listLocalMemoryFiles(workspaceRoot);
  const manifest: MemoryManifestEntry[] = localFiles.map((f) => ({
    path: f.path,
    checksum: f.checksum,
  }));
  const state = readMemorySyncState(workspaceRoot);

  const push: MemoryPushEntry[] = [];
  if (pushPaths !== undefined) {
    const pushSet = new Set(pushPaths.map(normalizeMemoryPath));
    for (const f of localFiles) {
      if (pushSet.has(f.path)) {
        push.push({ path: f.path, content: f.content });
      }
    }
    for (const p of pushSet) {
      if (!localFiles.some((f) => f.path === p)) {
        const content = readMemoryFromCache(workspaceRoot, p);
        if (content !== null) {
          push.push({ path: p, content });
        }
      }
    }
  }

  const response = await client.memorySync({ manifest, push });
  const pulled = applyMemoryPullToCache(workspaceRoot, response.pull);
  const pushed = response.push_accepted.length;

  const afterFiles = listLocalMemoryFiles(workspaceRoot);
  const afterChecksum = aggregateManifestChecksum(
    afterFiles.map((f) => ({ path: f.path, checksum: f.checksum })),
  );

  writeMemorySyncState(workspaceRoot, {
    lastManifestChecksum: afterChecksum,
    serverTime: response.server_time,
  });

  const skipped =
    pulled === 0 &&
    pushed === 0 &&
    push.length === 0 &&
    state.lastManifestChecksum === aggregateManifestChecksum(manifest) &&
    response.pull.length === 0;

  return {
    pulled,
    pushed,
    skipped,
    cacheInvalidated: pulled > 0 || pushed > 0,
  };
}

/** @internal test helper */
export function resetMemorySyncStateForTests(workspaceRoot: string): void {
  const path = syncStatePath(workspaceRoot);
  if (existsSync(path)) rmSync(path);
  const cache = cacheRoot(workspaceRoot);
  if (existsSync(cache)) rmSync(cache, { recursive: true, force: true });
}

/** @internal test helper */
export function memoryCacheExists(workspaceRoot: string, filePath: string): boolean {
  const abs = join(cacheRoot(workspaceRoot), normalizeMemoryPath(filePath));
  return existsSync(abs) && statSync(abs).isFile();
}
