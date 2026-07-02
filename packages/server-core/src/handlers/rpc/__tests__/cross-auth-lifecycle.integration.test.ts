/**
 * VAL-CROSS-012, VAL-CROSS-013 — auth lifecycle with synced gateway state (live gateway).
 * Requires gateway on 8847 and local DB 5433.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client';
import {
  clearGatewaySession,
  getGatewaySessionState,
  getStoredGatewayToken,
  loginGateway,
  logoutGateway,
} from '@craft-agent/origincoworks/auth';
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
import { fetchDesktopConfig } from '@craft-agent/origincoworks/desktop-config';

const GATEWAY = process.env.ORIGINCOWORKS_GATEWAY_URL ?? 'http://127.0.0.1:8847';
const USER = 'octest';
const PASS = 'OcTest1234!';
const OCTEST_MARKER = 'ZEBRA-QUARTERLY-7741';
const PSQL =
  'PGPASSWORD=jaco psql -h localhost -p 5433 -U jaco -d jacoworks -tAc';

async function gatewayUp(): Promise<boolean> {
  try {
    const r = await fetch(`${GATEWAY}/health`);
    return r.ok && (await r.text()) === 'ok';
  } catch {
    return false;
  }
}

function psqlQuery(sql: string): string {
  return execSync(`${PSQL} ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();
}

describe('cross-auth lifecycle (live)', () => {
  const dirs: string[] = [];
  const prevConfig = process.env.CRAFT_CONFIG_DIR;

  afterAll(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    if (prevConfig === undefined) delete process.env.CRAFT_CONFIG_DIR;
    else process.env.CRAFT_CONFIG_DIR = prevConfig;
  });

  it('VAL-CROSS-012: logout clears local session; gateway data survives; re-login restores sync', async () => {
    if (!(await gatewayUp())) {
      console.warn('Skipping: gateway not up');
      return;
    }

    const configRoot = mkdtempSync(join(tmpdir(), 'ocn-auth-012-'));
    dirs.push(configRoot);
    process.env.CRAFT_CONFIG_DIR = configRoot;

    const login1 = await loginGateway(USER, PASS, GATEWAY);
    expect(login1.success).toBe(true);
    if (!login1.success) return;

    const token1 = await getStoredGatewayToken();
    expect(token1).not.toBeNull();

    const client = new GatewayClient(GATEWAY, token1!);
    const me = await client.me();

    const memoryCountBefore = Number(
      psqlQuery(`select count(*) from user_memory where user_id = '${me.id}'`),
    );

    const marker = `CROSS-AUTH-012-${Date.now()}`;
    const memPath = `cross-auth-012/${marker}.md`;
    const memContent = `# logout survival\n${marker}\n`;
    writeMemoryToCache(configRoot, memPath, memContent);
    await syncGatewayMemoryToWorkspace({
      client,
      workspaceRoot: configRoot,
      pushPaths: [memPath],
    });

    const memoryCountAfterWrite = Number(
      psqlQuery(`select count(*) from user_memory where user_id = '${me.id}'`),
    );
    expect(memoryCountAfterWrite).toBeGreaterThanOrEqual(memoryCountBefore);

    await logoutGateway(GATEWAY);
    expect(await getStoredGatewayToken()).toBeNull();

    const memoryCountAfterLogout = Number(
      psqlQuery(`select count(*) from user_memory where user_id = '${me.id}'`),
    );
    expect(memoryCountAfterLogout).toBe(memoryCountAfterWrite);

    const verifyClient = new GatewayClient(GATEWAY);
    await verifyClient.login(USER, PASS);
    const searchAfterLogout = await verifyClient.searchMemory(marker, 5);
    expect(searchAfterLogout.some((h) => h.content.includes(marker))).toBe(true);

    await clearGatewaySession();

    const login2 = await loginGateway(USER, PASS, GATEWAY);
    expect(login2.success).toBe(true);
    if (!login2.success) return;

    const token2 = await getStoredGatewayToken();
    expect(token2).not.toBeNull();
    expect(token2).not.toBe(token1);

    const client2 = new GatewayClient(GATEWAY, token2!);
    await syncGatewayMemoryToWorkspace({ client: client2, workspaceRoot: configRoot });

    const readBack = readMemoryFromCache(configRoot, memPath);
    expect(readBack).toContain(marker);

    const seeded = await client2.searchMemory(OCTEST_MARKER, 5);
    expect(seeded.some((h) => h.content.includes(OCTEST_MARKER))).toBe(true);
  });

  it('VAL-CROSS-013: server-invalidated token forces reauth; re-login restores gateway sync and local sessions', async () => {
    if (!(await gatewayUp())) {
      console.warn('Skipping: gateway not up');
      return;
    }

    const configRoot = mkdtempSync(join(tmpdir(), 'ocn-auth-013-'));
    dirs.push(configRoot);
    process.env.CRAFT_CONFIG_DIR = configRoot;

    const wsRoot = join(configRoot, 'workspaces', 'ws-lifecycle');
    mkdirSync(wsRoot, { recursive: true });
    ensureSessionsDir(wsRoot);

    const login1 = await loginGateway(USER, PASS, GATEWAY);
    expect(login1.success).toBe(true);
    if (!login1.success) return;

    const token1 = await getStoredGatewayToken();
    expect(token1).not.toBeNull();

    const client1 = new GatewayClient(GATEWAY, token1!);
    await syncGatewayMemoryToWorkspace({ client: client1, workspaceRoot: configRoot });

    const session = await createSession(wsRoot, { name: 'Lifecycle session context' });
    const sessionId = session.id;

    psqlQuery(`DELETE FROM auth_sessions WHERE token = '${token1}'`);

    const state = await getGatewaySessionState(GATEWAY);
    expect(state.authenticated).toBe(false);
    if (state.authenticated) return;
    expect(state.reason).toBe('invalid_token');
    expect(await getStoredGatewayToken()).toBeNull();

    const login2 = await loginGateway(USER, PASS, GATEWAY);
    expect(login2.success).toBe(true);
    if (!login2.success) return;

    const token2 = await getStoredGatewayToken();
    expect(token2).not.toBeNull();

    const config = await fetchDesktopConfig(GATEWAY, token2!);
    expect(config.primary_model).toBe('gpt-5.5');
    expect(config.models.length).toBeGreaterThan(0);

    const client2 = new GatewayClient(GATEWAY, token2!);
    const memoryPull = await syncGatewayMemoryToWorkspace({
      client: client2,
      workspaceRoot: configRoot,
    });
    expect(memoryPull.pulled).toBeGreaterThanOrEqual(0);

    const sessionsAfter = listSessions(wsRoot);
    expect(sessionsAfter.some((s) => s.id === sessionId)).toBe(true);
  });
});
