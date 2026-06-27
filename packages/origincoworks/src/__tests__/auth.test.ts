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
  persistGatewaySession,
  getGatewaySessionState,
  logoutGateway,
  resolveGatewayBaseUrl,
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

  it('login targets configured gateway base URL', async () => {
    let loginUrl = '';
    let loginMethod: string | undefined;
    GatewayClient.setFetchForTests(async (input, init) => {
      loginUrl = String(input);
      loginMethod = init?.method;
      if (loginUrl.endsWith('/api/auth/login')) {
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

    await loginGateway('octest', 'secret', 'http://127.0.0.1:8847');
    expect(loginUrl).toBe('http://127.0.0.1:8847/api/auth/login');
    expect(loginMethod).toBe('POST');
  });
});

describe('resolveGatewayBaseUrl', () => {
  const prev = process.env.ORIGINCOWORKS_GATEWAY_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.ORIGINCOWORKS_GATEWAY_URL;
    else process.env.ORIGINCOWORKS_GATEWAY_URL = prev;
  });

  it('defaults to local gateway', () => {
    delete process.env.ORIGINCOWORKS_GATEWAY_URL;
    expect(resolveGatewayBaseUrl()).toBe('http://127.0.0.1:8847');
  });

  it('strips trailing slashes from env override', () => {
    process.env.ORIGINCOWORKS_GATEWAY_URL = 'http://example.test:9999///';
    expect(resolveGatewayBaseUrl()).toBe('http://example.test:9999');
  });
});

describe('getGatewaySessionState', () => {
  let configDir: string;
  const prevConfig = process.env.CRAFT_CONFIG_DIR;

  beforeEach(async () => {
    configDir = mkdtempSync(join(tmpdir(), 'ocn-session-'));
    process.env.CRAFT_CONFIG_DIR = configDir;
    GatewayClient.setFetchForTests(undefined);
    await clearGatewaySession();
  });

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.CRAFT_CONFIG_DIR;
    else process.env.CRAFT_CONFIG_DIR = prevConfig;
    GatewayClient.setFetchForTests(undefined);
    rmSync(configDir, { recursive: true, force: true });
  });

  it('returns unauthenticated when no token stored', async () => {
    const state = await getGatewaySessionState('http://127.0.0.1:8847');
    expect(state).toEqual({ authenticated: false, reason: 'no_token' });
  });

  it('returns user when token valid and attaches bearer on /me', async () => {
    await persistGatewaySession(TOKEN);
    let authHeader: string | null = null;
    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/users/me')) {
        const headers = new Headers(init?.headers);
        authHeader = headers.get('Authorization');
        return new Response(
          JSON.stringify({
            id: '1',
            name: 'octest',
            email: 'octest@local.test',
            role: 'admin',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const state = await getGatewaySessionState('http://127.0.0.1:8847');
    expect(state.authenticated).toBe(true);
    if (!state.authenticated) return;
    expect(state.user.name).toBe('octest');
    expect(authHeader).toBe(`Bearer ${TOKEN}`);
  });

  it('clears stored token on 401 from /me', async () => {
    await persistGatewaySession(TOKEN);
    GatewayClient.setFetchForTests(async (input) => {
      if (String(input).endsWith('/api/users/me')) {
        return new Response(JSON.stringify({ error: 'invalid session' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const state = await getGatewaySessionState('http://127.0.0.1:8847');
    expect(state).toEqual({ authenticated: false, reason: 'invalid_token' });
    expect(await getStoredGatewayToken()).toBeNull();
  });
});

describe('logoutGateway', () => {
  let configDir: string;
  const prevConfig = process.env.CRAFT_CONFIG_DIR;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'ocn-logout-'));
    process.env.CRAFT_CONFIG_DIR = configDir;
    GatewayClient.setFetchForTests(undefined);
  });

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.CRAFT_CONFIG_DIR;
    else process.env.CRAFT_CONFIG_DIR = prevConfig;
    GatewayClient.setFetchForTests(undefined);
    rmSync(configDir, { recursive: true, force: true });
  });

  it('revokes server session and clears local token', async () => {
    await persistGatewaySession(TOKEN);
    let logoutAuth: string | null = null;
    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/auth/logout')) {
        const headers = new Headers(init?.headers);
        logoutAuth = headers.get('Authorization');
        return new Response(null, { status: 204 });
      }
      return new Response('not found', { status: 404 });
    });

    await logoutGateway('http://127.0.0.1:8847');
    expect(logoutAuth).toBe(`Bearer ${TOKEN}`);
    expect(await getStoredGatewayToken()).toBeNull();
  });

  it('clears local token when no token stored', async () => {
    let called = false;
    GatewayClient.setFetchForTests(async () => {
      called = true;
      return new Response(null, { status: 204 });
    });
    await logoutGateway('http://127.0.0.1:8847');
    expect(called).toBe(false);
  });
});

describe('persistGatewaySession', () => {
  let configDir: string;
  const prevConfig = process.env.CRAFT_CONFIG_DIR;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'ocn-persist-'));
    process.env.CRAFT_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.CRAFT_CONFIG_DIR;
    else process.env.CRAFT_CONFIG_DIR = prevConfig;
    rmSync(configDir, { recursive: true, force: true });
  });

  it('rejects non-64-hex tokens', async () => {
    await expect(persistGatewaySession('not-a-token')).rejects.toThrow(/64 hex/);
  });
});
