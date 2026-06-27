import { describe, expect, it } from 'bun:test';
import {
  ORIGINCOWORKS_GATEWAY_LLM_SLUG,
  buildGatewayLlmConnectionFromDesktopConfig,
} from '../llm-config.ts';
import type { DesktopConfigResponse } from '../types.ts';

const sampleConfig: DesktopConfigResponse = {
  llm_proxy_url: 'https://api.xiaomao.chat',
  llm_proxy_key: 'proxy-key',
  primary_model: 'gpt-5.5',
  primary_provider: 'proxy-gpt',
  models: [
    { id: 'gpt-5.5', provider: 'proxy-gpt', label: 'GPT 5.5', context_window: 128000 },
  ],
};

describe('buildGatewayLlmConnectionFromDesktopConfig', () => {
  it('builds pi_compat openai-completions connection with gateway slug', () => {
    const conn = buildGatewayLlmConnectionFromDesktopConfig(sampleConfig, 1);
    expect(conn.slug).toBe(ORIGINCOWORKS_GATEWAY_LLM_SLUG);
    expect(conn.baseUrl).toBe('https://api.xiaomao.chat');
    expect(conn.defaultModel).toBe('gpt-5.5');
    expect(conn.customEndpoint).toEqual({ api: 'openai-completions' });
    expect(conn.providerType).toBe('pi_compat');
    expect(conn.authType).toBe('api_key_with_endpoint');
    expect(conn.managedByGateway).toBe(true);
    expect(conn.models).toHaveLength(1);
    expect(conn.models?.[0]).toMatchObject({ id: 'gpt-5.5', name: 'GPT 5.5' });
  });
});
