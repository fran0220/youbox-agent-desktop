/**
 * Gateway desktop config → piDriver.buildRuntime payload for pi-agent-server
 * (registerCustomEndpointModels + OpenAI-completions / xiaomao).
 */
import { describe, expect, it } from 'bun:test';
import { piDriver } from '../../../shared/src/agent/backend/internal/drivers/pi.ts';
import { providerTypeToAgentProvider } from '../../../shared/src/agent/backend/factory.ts';
import {
  ORIGINCOWORKS_GATEWAY_LLM_SLUG,
  buildGatewayLlmConnectionFromDesktopConfig,
} from '../llm-config.ts';
import type { DesktopConfigResponse } from '../types.ts';

const desktopConfig: DesktopConfigResponse = {
  llm_proxy_url: 'https://api.xiaomao.chat',
  llm_proxy_key: 'sk-test',
  primary_model: 'gpt-5.5',
  primary_provider: 'proxy-gpt',
  models: [
    { id: 'gpt-5.5', provider: 'proxy-gpt', label: 'GPT 5.5', context_window: 128000, reasoning: true },
    { id: 'gpt-4o', provider: 'proxy-gpt', label: 'GPT-4o', context_window: 128000 },
  ],
};

const resolvedPaths = {
  piServerPath: '/tmp/pi-agent-server.js',
  interceptorBundlePath: '/tmp/interceptor.cjs',
  nodeRuntimePath: '/usr/bin/node',
};

describe('gateway → Pi runtime payload (M4 streaming)', () => {
  it('buildGatewayLlmConnectionFromDesktopConfig is pi_compat openai-completions for xiaomao', () => {
    const conn = buildGatewayLlmConnectionFromDesktopConfig(desktopConfig, 1);
    expect(conn.slug).toBe(ORIGINCOWORKS_GATEWAY_LLM_SLUG);
    expect(providerTypeToAgentProvider(conn.providerType)).toBe('pi');
    expect(conn.baseUrl).toBe('https://api.xiaomao.chat/v1');
    expect(conn.customEndpoint).toEqual({ api: 'openai-completions' });
    expect(conn.piAuthProvider).toBe('openai');
    expect(conn.defaultModel).toBe('gpt-5.5');
  });

  it('piDriver.buildRuntime supplies baseUrl, customEndpoint, and customModels for subprocess init', () => {
    const conn = buildGatewayLlmConnectionFromDesktopConfig(desktopConfig, 1);

    const runtime = piDriver.buildRuntime({
      context: {
        provider: 'pi',
        authType: 'api_key_with_endpoint',
        resolvedModel: 'gpt-4o',
        capabilities: { needsHttpPoolServer: false },
        connection: conn,
      },
      coreConfig: {} as never,
      hostRuntime: {} as never,
      resolvedPaths,
    });

    expect(runtime.baseUrl).toBe('https://api.xiaomao.chat/v1');
    expect(runtime.customEndpoint).toEqual({ api: 'openai-completions' });
    expect(runtime.piAuthProvider).toBe('openai');
    expect(runtime.customModels).toEqual([
      { id: 'gpt-5.5', contextWindow: 128000 },
      { id: 'gpt-4o', contextWindow: 128000 },
    ]);
  });
});
