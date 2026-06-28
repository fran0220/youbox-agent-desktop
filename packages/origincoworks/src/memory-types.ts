/** Wire types for POST /api/memory/sync and related memory endpoints. */

export type MemoryManifestEntry = {
  path: string;
  checksum: string;
};

export type MemoryPushEntry = {
  path: string;
  content: string;
};

export type MemorySyncRequest = {
  manifest: MemoryManifestEntry[];
  push: MemoryPushEntry[];
};

export type MemoryPullEntry = {
  path: string;
  content: string;
  checksum: string;
};

export type MemorySyncResponse = {
  pull: MemoryPullEntry[];
  push_accepted: string[];
  server_time: string;
};

export type MemorySearchHit = {
  path: string;
  content: string;
  checksum: string;
  score?: number;
};

export type MemoryStatsResponse = {
  file_count: number;
  total_bytes: number;
};

function normalizeMemorySyncArrayField(value: unknown, field: string): unknown[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`memory sync response ${field} must be an array`);
  }
  return value;
}

export function assertMemorySyncResponse(value: unknown): asserts value is MemorySyncResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('memory sync response must be an object');
  }
  const o = value as Record<string, unknown>;
  o.pull = normalizeMemorySyncArrayField(o.pull, 'pull');
  o.push_accepted = normalizeMemorySyncArrayField(o.push_accepted, 'push_accepted');
}
