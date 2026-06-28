import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GatewayClient } from '../gateway-client.ts';
import {
  aggregateManifestChecksum,
  applyMemoryPullToCache,
  listLocalMemoryFiles,
  readMemoryFromCache,
  resetMemorySyncStateForTests,
  syncGatewayMemoryToWorkspace,
  writeMemoryToCache,
} from '../memory-sync.ts';
import { contentChecksum } from '../checksum.ts';

describe('memory-sync', () => {
  let workspaceRoot: string;

  afterEach(() => {
    if (workspaceRoot) {
      resetMemorySyncStateForTests(workspaceRoot);
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
    GatewayClient.setFetchForTests(undefined);
  });

  it('aggregateManifestChecksum is stable for the same manifest', () => {
    const manifest = [
      { path: 'b.md', checksum: 'aa' },
      { path: 'a.md', checksum: 'bb' },
    ];
    expect(aggregateManifestChecksum(manifest)).toBe(aggregateManifestChecksum([...manifest].reverse()));
  });

  it('applyMemoryPullToCache writes gateway pull entries locally', () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'ocn-mem-'));
    const n = applyMemoryPullToCache(workspaceRoot, [
      { path: 'MEMORY.md', content: '# Notes\n', checksum: contentChecksum('# Notes\n') },
    ]);
    expect(n).toBe(1);
    expect(readMemoryFromCache(workspaceRoot, 'MEMORY.md')).toBe('# Notes\n');
  });

  it('syncGatewayMemoryToWorkspace skips redundant pull when checksums match', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'ocn-mem-'));
    const content = 'hello gateway';
    writeMemoryToCache(workspaceRoot, 'MEMORY.md', content);
    const local = listLocalMemoryFiles(workspaceRoot);
    const manifest = local.map((f) => ({ path: f.path, checksum: f.checksum }));

    GatewayClient.setFetchForTests(async () => {
      return new Response(
        JSON.stringify({
          pull: [],
          push_accepted: [],
          server_time: new Date().toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const client = new GatewayClient('http://127.0.0.1:8847', 'a'.repeat(64));
    const first = await syncGatewayMemoryToWorkspace({ client, workspaceRoot });
    expect(first.pulled).toBe(0);
    expect(first.pushed).toBe(0);

    const second = await syncGatewayMemoryToWorkspace({ client, workspaceRoot });
    expect(second.skipped).toBe(true);
    expect(second.pulled).toBe(0);
  });

  it('syncGatewayMemoryToWorkspace applies server pull when manifest differs', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'ocn-mem-'));
    writeMemoryToCache(workspaceRoot, 'MEMORY.md', 'local only');

    GatewayClient.setFetchForTests(async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(body.manifest).toBeDefined();
      return new Response(
        JSON.stringify({
          pull: [{ path: 'MEMORY.md', content: 'from server', checksum: contentChecksum('from server') }],
          push_accepted: [],
          server_time: new Date().toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const client = new GatewayClient('http://127.0.0.1:8847', 'b'.repeat(64));
    const result = await syncGatewayMemoryToWorkspace({ client, workspaceRoot });
    expect(result.pulled).toBe(1);
    expect(readMemoryFromCache(workspaceRoot, 'MEMORY.md')).toBe('from server');
    const statePath = join(workspaceRoot, '.gateway-memory-sync.json');
    expect(readFileSync(statePath, 'utf8')).toContain('lastManifestChecksum');
  });

  it('readMemoryFromCache serves offline reads after pull is cached', () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'ocn-mem-'));
    applyMemoryPullToCache(workspaceRoot, [
      { path: 'prefs.md', content: 'offline ok', checksum: contentChecksum('offline ok') },
    ]);
    expect(readMemoryFromCache(workspaceRoot, 'prefs.md')).toBe('offline ok');
  });
});
