import { afterEach, describe, expect, it } from 'bun:test';
import { GatewayClient } from '../gateway-client.ts';
import { fetchDesktopConfig } from '../desktop-config.ts';

const sampleBody = {
  llm_proxy_url: 'https://api.xiaomao.chat',
  llm_proxy_key: 'key',
  primary_model: 'gpt-5.5',
  primary_provider: 'proxy-gpt',
  models: [{ id: 'gpt-5.5', provider: 'proxy-gpt', label: 'GPT 5.5' }],
};

describe('fetchDesktopConfig', () => {
  afterEach(() => {
    GatewayClient.setFetchForTests(undefined);
  });

  it('calls GET /api/desktop/config with bearer auth', async () => {
    let seenUrl = '';
    let seenAuth = '';
    GatewayClient.setFetchForTests(async (input, init) => {
      seenUrl = String(input);
      seenAuth = new Headers(init?.headers).get('Authorization') ?? '';
      return new Response(JSON.stringify(sampleBody), { status: 200 });
    });

    const config = await fetchDesktopConfig('http://127.0.0.1:8847', 'a'.repeat(64));
    expect(seenUrl).toContain('/api/desktop/config');
    expect(seenAuth).toMatch(/^Bearer /);
    expect(config.primary_model).toBe('gpt-5.5');
  });
});
