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

export function assertMemorySyncResponse(value: unknown): asserts value is MemorySyncResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('memory sync response must be an object');
  }
  const o = value as Record<string, unknown>;
  if (!Array.isArray(o.pull)) {
    throw new Error('memory sync response missing pull array');
  }
  if (!Array.isArray(o.push_accepted)) {
    throw new Error('memory sync response missing push_accepted');
  }
}
