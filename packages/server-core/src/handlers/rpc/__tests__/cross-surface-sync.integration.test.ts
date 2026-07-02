/**
 * Live-gateway integration: memory push + pull across isolated config dirs (desktop vs WebUI dirs).
 * Requires gateway on 8847 and local DB 5433.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client';
import { getStoredGatewayToken, loginGateway } from '@craft-agent/origincoworks/auth';
import {
  readMemoryFromCache,
  syncGatewayMemoryToWorkspace,
  writeMemoryToCache,
} from '@craft-agent/origincoworks/memory-sync';

const GATEWAY = process.env.ORIGINCOWORKS_GATEWAY_URL ?? 'http://127.0.0.1:8847';
const USER = 'octest';
const PASS = 'OcTest1234!';

async function gatewayUp(): Promise<boolean> {
  try {
    const r = await fetch(`${GATEWAY}/health`);
    return r.ok && (await r.text()) === 'ok';
  } catch {
    return false;
  }
}

describe('cross-surface gateway sync (live)', () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('memory written in desktop dir appears in WebUI dir after sync (VAL-CROSS-005)', async () => {
    if (!(await gatewayUp())) {
      console.warn('Skipping: gateway not up');
      return;
    }

    const login = await loginGateway(USER, PASS, GATEWAY);
    expect(login.success).toBe(true);
    if (!login.success) return;
    const token = await getStoredGatewayToken();
    expect(token).not.toBeNull();

    const marker = `CROSS-SURFACE-MEM-${Date.now()}`;
    const path = `cross-surface/${marker}.md`;
    const content = `# Cross surface\n${marker}\n`;

    const desktopRoot = mkdtempSync(join(tmpdir(), 'ocn-desktop-'));
    const webuiRoot = mkdtempSync(join(tmpdir(), 'ocn-webui-'));
    dirs.push(desktopRoot, webuiRoot);

    const client = new GatewayClient(GATEWAY, token!);
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
  });
});
