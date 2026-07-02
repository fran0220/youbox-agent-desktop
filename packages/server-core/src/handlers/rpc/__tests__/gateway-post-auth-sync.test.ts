import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import * as gatewayAuth from '@craft-agent/origincoworks/auth';
import type { HandlerDeps } from '../../handler-deps';
import { syncGatewayStateAfterAuth } from '../gateway-post-auth-sync';
import * as gatewayLlmSync from '../gateway-llm-sync.ts';
import * as gatewayMemorySync from '../gateway-memory-sync.ts';

function minimalDeps(): HandlerDeps {
  return {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
  };
}

describe('syncGatewayStateAfterAuth', () => {
  let tokenSpy: ReturnType<typeof spyOn<typeof gatewayAuth, 'getStoredGatewayToken'>>;
  let llmSpy: ReturnType<typeof spyOn<typeof gatewayLlmSync, 'syncGatewayLlmConfigForSession'>>;
  let memorySpy: ReturnType<typeof spyOn<typeof gatewayMemorySync, 'syncGatewayMemoryForSession'>>;

  afterEach(() => {
    tokenSpy?.mockRestore();
    llmSpy?.mockRestore();
    memorySpy?.mockRestore();
  });

  it('runs LLM and memory sync when token exists and rpcServer is provided', async () => {
    tokenSpy = spyOn(gatewayAuth, 'getStoredGatewayToken').mockResolvedValue('a'.repeat(64));
    llmSpy = spyOn(gatewayLlmSync, 'syncGatewayLlmConfigForSession').mockResolvedValue({
      success: true,
      slug: 'origincoworks-gateway',
      primaryModel: 'gpt-5.5',
    });
    memorySpy = spyOn(gatewayMemorySync, 'syncGatewayMemoryForSession').mockResolvedValue({
      success: true,
      pulled: 2,
      pushed: 0,
      skipped: false,
    });

    const deps = minimalDeps();
    const server = { handle() {}, push() {}, invokeClient: async () => undefined, hasClientCapability: () => false, findClientsWithCapability: () => [] };

    const result = await syncGatewayStateAfterAuth({
      sessionManager: deps.sessionManager,
      deps,
      rpcServer: server,
    });

    expect(result.llm.success).toBe(true);
    expect(result.memory.success).toBe(true);
    expect(llmSpy).toHaveBeenCalledTimes(1);
    expect(memorySpy).toHaveBeenCalledTimes(1);
  });

  it('returns failures when not signed in', async () => {
    tokenSpy = spyOn(gatewayAuth, 'getStoredGatewayToken').mockResolvedValue(null);
    const deps = minimalDeps();
    const result = await syncGatewayStateAfterAuth({ sessionManager: deps.sessionManager, deps });
    expect(result.llm.success).toBe(false);
    expect(result.memory.success).toBe(false);
  });
});
