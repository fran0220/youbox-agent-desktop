import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { searchMemoryInCache } from '../memory-search.ts';
import { applyMemoryPullToCache } from '../memory-sync.ts';
import { contentChecksum } from '../checksum.ts';

describe('memory-search', () => {
  it('searchMemoryInCache matches substring in path and content', () => {
    const root = mkdtempSync(join(tmpdir(), 'ocn-mem-search-'));
    try {
      applyMemoryPullToCache(root, [
        { path: 'notes/alpha.md', content: 'gateway fact', checksum: contentChecksum('gateway fact') },
        { path: 'beta.md', content: 'other', checksum: contentChecksum('other') },
      ]);
      const hits = searchMemoryInCache(root, 'gateway', 10);
      expect(hits.length).toBe(1);
      expect(hits[0]?.path).toBe('notes/alpha.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
