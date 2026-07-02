/**
 * VAL-CROSS-007, VAL-CROSS-008, VAL-CROSS-022 — multi-user / cross-surface isolation (live gateway).
 * Requires gateway on 8847 and local DB 5433.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GatewayClient, GatewayHttpError } from '@craft-agent/origincoworks/gateway-client';
import {
  readMemoryFromCache,
  syncGatewayMemoryToWorkspace,
  writeMemoryToCache,
} from '@craft-agent/origincoworks/memory-sync';
import {
  createSession,
  ensureSessionsDir,
  listSessions,
} from '@craft-agent/shared/sessions';

const GATEWAY = process.env.ORIGINCOWORKS_GATEWAY_URL ?? 'http://127.0.0.1:8847';

const USER_A = { name: 'octest', pass: 'OcTest1234!' };
const USER_B = { name: 'octest2', pass: 'OcTest2_1234!' };

const OCTEST_MARKER = 'ZEBRA-QUARTERLY-7741';
const OCTEST2_MEMORY_MARKER = 'OCTEST2-ISOLATION-MARKER-8847';

async function gatewayUp(): Promise<boolean> {
  try {
    const r = await fetch(`${GATEWAY}/health`);
    return r.ok && (await r.text()) === 'ok';
  } catch {
    return false;
  }
}

async function loginClient(username: string, password: string): Promise<GatewayClient> {
  const client = new GatewayClient(GATEWAY);
  await client.login(username, password);
  return client;
}

async function ensureOctest2Fixtures(): Promise<void> {
  const client = await loginClient(USER_B.name, USER_B.pass);
  const hits = await client.searchMemory(OCTEST2_MEMORY_MARKER, 5);
  if (!hits.some((h) => h.content.includes(OCTEST2_MEMORY_MARKER))) {
    await client.memorySync({
      manifest: [],
      push: [
        {
          path: 'MEMORY.md',
          content: `# octest2 private memory\n${OCTEST2_MEMORY_MARKER}\n`,
        },
      ],
    });
  }
}

describe('cross-multiuser isolation (live)', () => {
  const dirs: string[] = [];

  beforeAll(async () => {
    if (!(await gatewayUp())) return;
    await ensureOctest2Fixtures();
  });

  afterAll(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('VAL-CROSS-007: A and B gateway memory data is disjoint', async () => {
    if (!(await gatewayUp())) {
      console.warn('Skipping: gateway not up');
      return;
    }

    const clientA = await loginClient(USER_A.name, USER_A.pass);
    const clientB = await loginClient(USER_B.name, USER_B.pass);
    const meA = await clientA.me();
    const meB = await clientB.me();
    expect(meA.id).not.toBe(meB.id);

    const memA = await clientA.searchMemory(OCTEST_MARKER, 10);
    const memB = await clientB.searchMemory(OCTEST2_MEMORY_MARKER, 10);
    expect(memA.some((h) => h.content.includes(OCTEST_MARKER))).toBe(true);
    expect(memB.some((h) => h.content.includes(OCTEST2_MEMORY_MARKER))).toBe(true);
    expect(memA.some((h) => h.content.includes(OCTEST2_MEMORY_MARKER))).toBe(false);
    expect(memB.some((h) => h.content.includes(OCTEST_MARKER))).toBe(false);
  });

  it('VAL-CROSS-008: octest write on desktop dir visible on WebUI dir after sync (single DB row)', async () => {
    if (!(await gatewayUp())) {
      console.warn('Skipping: gateway not up');
      return;
    }

    const client = await loginClient(USER_A.name, USER_A.pass);
    const marker = `CROSS-008-${Date.now()}`;
    const path = `cross-008/${marker}.md`;
    const content = `# cross 008\n${marker}\n`;

    const desktopRoot = mkdtempSync(join(tmpdir(), 'ocn-008-desktop-'));
    const webuiRoot = mkdtempSync(join(tmpdir(), 'ocn-008-webui-'));
    dirs.push(desktopRoot, webuiRoot);

    writeMemoryToCache(desktopRoot, path, content);
    const pushResult = await syncGatewayMemoryToWorkspace({
      client,
      workspaceRoot: desktopRoot,
      pushPaths: [path],
    });
    expect(pushResult.pushed).toBeGreaterThanOrEqual(1);

    const pullResult = await syncGatewayMemoryToWorkspace({
      client,
      workspaceRoot: webuiRoot,
    });
    expect(pullResult.pulled).toBeGreaterThanOrEqual(1);

    const read = readMemoryFromCache(webuiRoot, path);
    expect(read).toContain(marker);

    const search = await client.searchMemory(marker, 5);
    expect(search.filter((h) => h.path === path).length).toBe(1);
  });

  it('VAL-CROSS-022: B native session invisible to A (local list + gateway fetch)', async () => {
    if (!(await gatewayUp())) {
      console.warn('Skipping: gateway not up');
      return;
    }

    const clientA = await loginClient(USER_A.name, USER_A.pass);

    const configA = mkdtempSync(join(tmpdir(), 'ocn-022-a-'));
    const configB = mkdtempSync(join(tmpdir(), 'ocn-022-b-'));
    dirs.push(configA, configB);

    const wsA = join(configA, 'workspaces', 'ws-a');
    const wsB = join(configB, 'workspaces', 'ws-b');
    mkdirSync(wsA, { recursive: true });
    mkdirSync(wsB, { recursive: true });

    ensureSessionsDir(wsA);
    ensureSessionsDir(wsB);

    const sessionB = await createSession(wsB, { name: 'B-only cross-surface session' });
    const sessionBId = sessionB.id;

    const listA = listSessions(wsA);
    const listB = listSessions(wsB);
    expect(listB.some((s) => s.id === sessionBId)).toBe(true);
    expect(listA.some((s) => s.id === sessionBId)).toBe(false);

    let gatewayError = false;
    try {
      await clientA.getClassicSession(sessionBId);
    } catch (err) {
      gatewayError = err instanceof GatewayHttpError;
    }
    expect(gatewayError).toBe(true);
  });
});
