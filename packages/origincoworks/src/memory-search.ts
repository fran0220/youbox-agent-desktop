import type { GatewayClient } from './gateway-client.ts';
import type { MemorySearchHit } from './memory-types.ts';
import { listLocalMemoryFiles } from './memory-sync.ts';

/** Local substring search when gateway is unreachable (offline cache). */
export function searchMemoryInCache(
  workspaceRoot: string,
  query: string,
  limit = 20,
): MemorySearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const files = listLocalMemoryFiles(workspaceRoot);
  const hits: MemorySearchHit[] = [];
  for (const f of files) {
    if (f.content.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) {
      hits.push({
        path: f.path,
        content: f.content,
        checksum: f.checksum,
      });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

export async function searchMemory(options: {
  client: GatewayClient | null;
  workspaceRoot: string;
  query: string;
  limit?: number;
}): Promise<{ hits: MemorySearchHit[]; offline: boolean }> {
  const { client, workspaceRoot, query, limit = 20 } = options;
  if (client) {
    try {
      const hits = await client.searchMemory(query, limit);
      return { hits, offline: false };
    } catch {
      // fall through to cache
    }
  }
  return { hits: searchMemoryInCache(workspaceRoot, query, limit), offline: true };
}
