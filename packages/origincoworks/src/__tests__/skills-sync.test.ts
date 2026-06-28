import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  applySkillFilesToWorkspace,
  readSkillsSyncState,
  resetSkillsSyncStateForTests,
  syncSkillsForOwner,
  syncGatewaySkillsToWorkspaces,
  listSyncedSkillSlugs,
} from '../skills-sync.ts';
import { contentChecksum } from '../checksum.ts';
import { GatewayClient } from '../gateway-client.ts';

describe('applySkillFilesToWorkspace', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('writes multi-file skill under skills/{slug}/', () => {
    root = mkdtempSync(join(tmpdir(), 'ocn-skills-'));
    const body = '---\nname: probe\ndescription: d\n---\nDo the marker.\n';
    const files = [
      {
        file_path: 'probe/SKILL.md',
        content: body,
        checksum: contentChecksum(body),
      },
      {
        file_path: 'probe/refs/extra.md',
        content: 'aux',
        checksum: contentChecksum('aux'),
      },
    ];
    const { written, skipped } = applySkillFilesToWorkspace(root, files);
    expect(written).toBe(2);
    expect(skipped).toBe(0);
    expect(readFileSync(join(root, 'skills', 'probe', 'SKILL.md'), 'utf8')).toBe(body);
    expect(readFileSync(join(root, 'skills', 'probe', 'refs', 'extra.md'), 'utf8')).toBe('aux');
  });

  it('skips rewrite when local checksum matches remote', () => {
    root = mkdtempSync(join(tmpdir(), 'ocn-skills-'));
    const body = '---\nname: a\ndescription: b\n---\n';
    applySkillFilesToWorkspace(root, [
      { file_path: 'a/SKILL.md', content: body, checksum: contentChecksum(body) },
    ]);
    const skillPath = join(root, 'skills', 'a', 'SKILL.md');
    const before = readFileSync(skillPath);
    const { written, skipped } = applySkillFilesToWorkspace(root, [
      { file_path: 'a/SKILL.md', content: body, checksum: contentChecksum(body) },
    ]);
    expect(written).toBe(0);
    expect(skipped).toBe(1);
    expect(readFileSync(skillPath)).toEqual(before);
  });
});

describe('syncSkillsForOwner', () => {
  let root: string;

  afterEach(() => {
    if (root) {
      resetSkillsSyncStateForTests(root);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('short-circuits when aggregate checksum unchanged', async () => {
    root = mkdtempSync(join(tmpdir(), 'ocn-skills-'));
    const state = { owners: { system: 'abc123' } };
    let pullCalls = 0;
    const result = await syncSkillsForOwner(root, 'system', 'abc123', state, async () => {
      pullCalls += 1;
      return { status: 200, checksum: 'abc123', files: [] };
    });
    expect(result.pulled).toBe(false);
    expect(pullCalls).toBe(0);
  });

  it('handles 304 without writing files', async () => {
    root = mkdtempSync(join(tmpdir(), 'ocn-skills-'));
    const state = { owners: {} };
    const result = await syncSkillsForOwner(root, 'system', 'newsum', state, async () => ({
      status: 304,
      checksum: 'newsum',
      files: [],
    }));
    expect(result.pulled).toBe(true);
    expect(result.filesWritten).toBe(0);
    expect(state.owners.system).toBe('newsum');
  });
});

describe('syncGatewaySkillsToWorkspaces', () => {
  let root: string;
  afterEach(() => {
    GatewayClient.setFetchForTests(undefined);
    if (root) {
      resetSkillsSyncStateForTests(root);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('pulls only when checksum differs between runs', async () => {
    root = mkdtempSync(join(tmpdir(), 'ocn-skills-'));
    const body = '---\nname: s\ndescription: d\n---\n';
    const remoteChecksum = 'remote-agg-1';
    let pullCount = 0;

    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/skills/checksum')) {
        return new Response(JSON.stringify({ system: remoteChecksum, user: '' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/skills/pull')) {
        pullCount += 1;
        const etag = remoteChecksum;
        const inm = (init?.headers as Headers | undefined)?.get?.('If-None-Match')
          ?? (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];
        if (pullCount > 1 && inm === remoteChecksum) {
          return new Response(null, { status: 304, headers: { ETag: remoteChecksum } });
        }
        return new Response(
          JSON.stringify({
            checksum: etag,
            files: [{ file_path: 's/SKILL.md', content: body, checksum: contentChecksum(body) }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json', ETag: etag } },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const client = new GatewayClient('http://127.0.0.1:8847', 'a'.repeat(64));
    const first = await syncGatewaySkillsToWorkspaces({
      client,
      workspaceRoots: [root],
      userId: 'user-1',
    });
    expect(first.filesWritten).toBe(1);
    expect(listSyncedSkillSlugs(root)).toContain('s');

    const second = await syncGatewaySkillsToWorkspaces({
      client,
      workspaceRoots: [root],
      userId: 'user-1',
    });
    expect(second.filesWritten).toBe(0);
    expect(second.filesSkipped).toBe(0);
    expect(pullCount).toBe(1);
    expect(readSkillsSyncState(root).owners.system).toBe(remoteChecksum);
  });
});
