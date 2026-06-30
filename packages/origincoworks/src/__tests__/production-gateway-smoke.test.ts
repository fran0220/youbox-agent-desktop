/**
 * Optional smoke probe against the production JAcoworks gateway.
 * Run: ORIGINAI_PRODUCTION_GATEWAY_SMOKE=1 bun test src/__tests__/production-gateway-smoke.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { resolveGatewayBaseUrl } from '../auth.ts';

const RUN_SMOKE = process.env.ORIGINAI_PRODUCTION_GATEWAY_SMOKE === '1';
const PRODUCTION_GATEWAY = 'https://jacoapi.jingao.club';

async function probe(path: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const base = resolveGatewayBaseUrl();
  const url = `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, init);
  const body = await res.text();
  return { status: res.status, body };
}

describe('production gateway smoke (opt-in)', () => {
  it.skipIf(!RUN_SMOKE)('targets production gateway URL', () => {
    process.env.ORIGINAI_GATEWAY_URL = PRODUCTION_GATEWAY;
    expect(resolveGatewayBaseUrl()).toBe(PRODUCTION_GATEWAY);
  });

  it.skipIf(!RUN_SMOKE)('/health returns ok', async () => {
    process.env.ORIGINAI_GATEWAY_URL = PRODUCTION_GATEWAY;
    const { status, body } = await probe('/health');
    expect(status).toBe(200);
    expect(body).toBe('ok');
  });

  it.skipIf(!RUN_SMOKE)('/api/auth/login route exists (401 on bad creds)', async () => {
    process.env.ORIGINAI_GATEWAY_URL = PRODUCTION_GATEWAY;
    const { status, body } = await probe('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'smoke-probe', password: 'invalid' }),
    });
    expect(status).toBe(401);
    expect(body).toContain('invalid credentials');
  });

  it.skipIf(!RUN_SMOKE)('/api/users/me requires auth (401)', async () => {
    process.env.ORIGINAI_GATEWAY_URL = PRODUCTION_GATEWAY;
    const { status } = await probe('/api/users/me', {
      headers: { Authorization: 'Bearer ' + 'a'.repeat(64) },
    });
    expect(status).toBe(401);
  });

  it.skipIf(!RUN_SMOKE)('desktop endpoints are registered (401 without token, not 404)', async () => {
    process.env.ORIGINAI_GATEWAY_URL = PRODUCTION_GATEWAY;
    for (const path of ['/api/desktop/config', '/api/desktop/classic-sessions', '/api/desktop/policy']) {
      const { status } = await probe(path);
      expect(status).not.toBe(404);
      expect(status).toBe(401);
    }
  });
});