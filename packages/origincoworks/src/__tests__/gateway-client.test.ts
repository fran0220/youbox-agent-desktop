import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GatewayClient, GatewayHttpError } from '../gateway-client.ts';
import type { LoginResponse } from '../types.ts';
import { assertLoginResponse, isGatewayUser } from '../types.ts';

const LIVE_GATEWAY = process.env.ORIGINCOWORKS_GATEWAY_URL ?? 'http://127.0.0.1:8847';
const RUN_LIVE = process.env.ORIGINCOWORKS_LIVE_TESTS === '1';

describe('package exports', () => {
  it('resolves @craft-agent/origincoworks entry', async () => {
    const mod = await import('@craft-agent/origincoworks');
    expect(typeof mod.GatewayClient).toBe('function');
    expect(typeof mod.assertLoginResponse).toBe('function');
  });
});

describe('types', () => {
  it('assertLoginResponse accepts valid 64-hex token and user', () => {
    const payload: LoginResponse = {
      token: 'a'.repeat(64),
      user: { id: 'u1', name: 'octest', email: 'octest@local.test', role: 'admin' },
    };
    expect(() => assertLoginResponse(payload)).not.toThrow();
    expect(isGatewayUser(payload.user)).toBe(true);
  });

  it('assertLoginResponse rejects short token', () => {
    expect(() =>
      assertLoginResponse({
        token: 'abc',
        user: { id: 'u1', name: 'n', email: 'e', role: 'admin' },
      }),
    ).toThrow(/64/);
  });

  it('assertLoginResponse rejects missing user fields', () => {
    expect(() =>
      assertLoginResponse({
        token: 'b'.repeat(64),
        user: { id: 'u1', name: '', email: 'e', role: 'admin' },
      }),
    ).toThrow();
  });
});

describe('GatewayClient (mocked fetch)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    GatewayClient.setFetchForTests(undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    GatewayClient.setFetchForTests(undefined);
  });

  it('health returns true when body is ok', async () => {
    GatewayClient.setFetchForTests(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url.endsWith('/health')).toBe(true);
      return new Response('ok', { status: 200 });
    });
    const client = new GatewayClient('http://gateway.test');
    await expect(client.health()).resolves.toBe(true);
  });

  it('health rejects when body is not ok', async () => {
    GatewayClient.setFetchForTests(async () => new Response('down', { status: 200 }));
    const client = new GatewayClient('http://gateway.test');
    await expect(client.health()).rejects.toThrow(/unexpected health body/);
  });

  it('health surfaces connection errors', async () => {
    GatewayClient.setFetchForTests(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new GatewayClient('http://127.0.0.1:1');
    await expect(client.health()).rejects.toThrow();
  });

  it('login parses token and user', async () => {
    const token = 'c'.repeat(64);
    GatewayClient.setFetchForTests(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input).endsWith('/api/auth/login')).toBe(true);
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ username: 'octest', password: 'secret' });
      return new Response(
        JSON.stringify({
          token,
          user: { id: 'id-1', name: 'octest', email: 'octest@local.test', role: 'admin' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const client = new GatewayClient('http://gateway.test');
    const result = await client.login('octest', 'secret');
    expect(result.token).toBe(token);
    expect(result.user.name).toBe('octest');
    expect(client.getToken()).toBe(token);
  });

  it('login throws GatewayHttpError on 401', async () => {
    GatewayClient.setFetchForTests(async () =>
      new Response(JSON.stringify({ error: 'invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new GatewayClient('http://gateway.test');
    await expect(client.login('octest', 'wrong')).rejects.toMatchObject({
      name: 'GatewayHttpError',
      status: 401,
    });
  });

  it('me requires a token', async () => {
    const client = new GatewayClient('http://gateway.test');
    await expect(client.me()).rejects.toThrow(/token/);
  });

  it('me returns user with bearer token', async () => {
    GatewayClient.setFetchForTests(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input).endsWith('/api/users/me')).toBe(true);
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer mytoken');
      return new Response(
        JSON.stringify({ id: 'id-1', name: 'octest', email: 'octest@local.test', role: 'admin' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const client = new GatewayClient('http://gateway.test', 'mytoken');
    const user = await client.me();
    expect(user.name).toBe('octest');
  });
});

describe('GatewayClient live gateway', () => {
  it.skipIf(!RUN_LIVE)('health returns ok against live gateway', async () => {
    const client = new GatewayClient(LIVE_GATEWAY);
    await expect(client.health()).resolves.toBe(true);
  });

  it.skipIf(!RUN_LIVE)('login returns 64-hex token and user for octest', async () => {
    const client = new GatewayClient(LIVE_GATEWAY);
    const result = await client.login('octest', 'OcTest1234!');
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.user.role).toBe('admin');
    expect(result.user.name).toBe('octest');
  });

  it.skipIf(!RUN_LIVE)('login rejects invalid password', async () => {
    const client = new GatewayClient(LIVE_GATEWAY);
    await expect(client.login('octest', 'wrong-password')).rejects.toBeInstanceOf(GatewayHttpError);
  });

  it.skipIf(!RUN_LIVE)('me returns octest after login', async () => {
    const client = new GatewayClient(LIVE_GATEWAY);
    await client.login('octest', 'OcTest1234!');
    const me = await client.me();
    expect(me.name).toBe('octest');
  });

  it.skipIf(!RUN_LIVE)('health fails against closed port', async () => {
    const client = new GatewayClient('http://127.0.0.1:59999');
    await expect(client.health()).rejects.toThrow();
  });
});
