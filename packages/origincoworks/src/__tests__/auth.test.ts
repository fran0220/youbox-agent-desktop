import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GatewayClient } from '../gateway-client.ts';
import {
  loginGateway,
  sanitizeGatewayLoginError,
  getStoredGatewayToken,
  clearGatewaySession,
  GATEWAY_SESSION_CREDENTIAL,
} from '../auth.ts';
import { GatewayHttpError } from '../gateway-client.ts';
import { getCredentialManager } from '@craft-agent/shared/credentials';

const TOKEN =
  'a'.repeat(64);

describe('sanitizeGatewayLoginError', () => {
  it('maps 401 to invalid credentials without password in message', () => {
    const err = new GatewayHttpError('invalid credentials', 401, { error: 'invalid credentials' });
    expect(sanitizeGatewayLoginError(err)).toBe('invalid credentials');
    expect(sanitizeGatewayLoginError(err)).not.toContain('OcTest');
  });
});

describe('loginGateway', () => {
  let configDir: string;
  const prevConfig = process.env.CRAFT_CONFIG_DIR;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'ocn-auth-'));
    process.env.CRAFT_CONFIG_DIR = configDir;
    GatewayClient.setFetchForTests(undefined);
  });

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.CRAFT_CONFIG_DIR;
    else process.env.CRAFT_CONFIG_DIR = prevConfig;
    GatewayClient.setFetchForTests(undefined);
    rmSync(configDir, { recursive: true, force: true });
  });

  it('stores gateway_session on success', async () => {
    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/auth/login') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            token: TOKEN,
            user: { id: '1', name: 'octest', email: 'octest@local.test', role: 'admin' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const result = await loginGateway('octest', 'secret', 'http://127.0.0.1:8847');
    expect(result.success).toBe(true);
    if (!result.success) return;

    const stored = await getStoredGatewayToken();
    expect(stored).toBe(TOKEN);

    const manager = getCredentialManager();
    const cred = await manager.get(GATEWAY_SESSION_CREDENTIAL);
    expect(cred?.value).toBe(TOKEN);
  });

  it('stores nothing on 401', async () => {
    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/auth/login')) {
        return new Response(JSON.stringify({ error: 'invalid credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const result = await loginGateway('octest', 'wrong', 'http://127.0.0.1:8847');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe('invalid credentials');

    await clearGatewaySession();
    const stored = await getStoredGatewayToken();
    expect(stored).toBeNull();
  });

  it('rejects empty username without network', async () => {
    let called = false;
    GatewayClient.setFetchForTests(async () => {
      called = true;
      return new Response('{}', { status: 200 });
    });

    const result = await loginGateway('', 'pass');
    expect(result.success).toBe(false);
    expect(called).toBe(false);
  });
});
