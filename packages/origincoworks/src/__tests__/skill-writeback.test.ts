import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GatewayClient } from '../gateway-client.ts';
import {
  collectSkillFilesFromWorkspace,
  writeUserSkillToGateway,
} from '../skill-writeback.ts';

describe('collectSkillFilesFromWorkspace', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('collects SKILL.md and auxiliary files with relative paths', () => {
    root = mkdtempSync(join(tmpdir(), 'ocn-wb-'));
    const skillDir = join(root, 'skills', 'my-skill');
    mkdirSync(join(skillDir, 'refs'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: n\ndescription: d\n---\n');
    writeFileSync(join(skillDir, 'refs', 'extra.md'), 'aux');

    const files = collectSkillFilesFromWorkspace(root, 'my-skill');
    expect(files.length).toBe(2);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['SKILL.md', 'refs/extra.md']);
  });
});

describe('writeUserSkillToGateway', () => {
  let root: string;

  afterEach(() => {
    GatewayClient.setFetchForTests(undefined);
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('PUTs collected files to /api/skills/{id}', async () => {
    root = mkdtempSync(join(tmpdir(), 'ocn-wb-'));
    const body = '---\nname: u\ndescription: d\n---\nedited\n';
    const skillDir = join(root, 'skills', 'user-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), body);

    let putUrl = '';
    let putBody: unknown;

    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/skills') && init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            skills: [{ id: 'user-skill', source: 'user', editable: true, file_count: 1 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/skills/user-skill') && init?.method === 'PUT') {
        putUrl = url;
        putBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({ status: 'ok', skill_id: 'user-skill', file_count: 1 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const client = new GatewayClient('http://127.0.0.1:8847', 'a'.repeat(64));
    const result = await writeUserSkillToGateway({
      client,
      workspaceRoot: root,
      skillSlug: 'user-skill',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fileCount).toBe(1);
    expect(putUrl).toContain('/api/skills/user-skill');
    expect(putBody).toEqual({
      files: [{ path: 'SKILL.md', content: body }],
    });
  });

  it('skips writeback for non-editable (builtin) skills', async () => {
    root = mkdtempSync(join(tmpdir(), 'ocn-wb-'));
    const skillDir = join(root, 'skills', 'builtin-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: b\ndescription: d\n---\n');

    let putCalls = 0;
    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/skills') && init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            skills: [{ id: 'builtin-skill', source: 'builtin', editable: false, file_count: 1 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (init?.method === 'PUT') {
        putCalls += 1;
      }
      return new Response('not found', { status: 404 });
    });

    const client = new GatewayClient('http://127.0.0.1:8847', 'a'.repeat(64));
    const result = await writeUserSkillToGateway({
      client,
      workspaceRoot: root,
      skillSlug: 'builtin-skill',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not a gateway user skill');
    expect(putCalls).toBe(0);
  });
});
