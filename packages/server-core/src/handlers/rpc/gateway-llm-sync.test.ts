import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { RpcServer } from '@craft-agent/server-core/transport';
import * as llmConfig from '@craft-agent/origincoworks/llm-config';
import type { HandlerDeps } from '../handler-deps';
import { ensureGatewayManagedLlmConnection, syncGatewayLlmConfigForSession } from './gateway-llm-sync.ts';
import * as gatewayAuth from '@craft-agent/origincoworks/auth';
import * as storage from '@craft-agent/shared/config';

describe('ensureGatewayManagedLlmConnection', () => {
  let tokenSpy: ReturnType<typeof spyOn<typeof gatewayAuth, 'getStoredGatewayToken'>>;
  let connSpy: ReturnType<typeof spyOn<typeof storage, 'getLlmConnection'>>;
  let defaultSpy: ReturnType<typeof spyOn<typeof storage, 'getDefaultLlmConnection'>>;
  let applySpy: ReturnType<typeof spyOn<typeof llmConfig, 'applyGatewayLlmConfigFromSession'>>;

  afterEach(() => {
    tokenSpy?.mockRestore();
    connSpy?.mockRestore();
    defaultSpy?.mockRestore();
    applySpy?.mockRestore();
  });

  it('skips when no gateway token', async () => {
    tokenSpy = spyOn(gatewayAuth, 'getStoredGatewayToken').mockResolvedValue(null);
    const sm = { reinitializeAuth: async () => {}, refreshConnectionRuntime: async () => {} };
    const r = await ensureGatewayManagedLlmConnection(sm);
    expect(r.synced).toBe(false);
  });

  it('applies desktop config when token exists but managed connection missing', async () => {
    tokenSpy = spyOn(gatewayAuth, 'getStoredGatewayToken').mockResolvedValue('a'.repeat(64));
    connSpy = spyOn(storage, 'getLlmConnection').mockReturnValue(null);
    defaultSpy = spyOn(storage, 'getDefaultLlmConnection').mockReturnValue(null);
    applySpy = spyOn(llmConfig, 'applyGatewayLlmConfigFromSession').mockResolvedValue({
      slug: 'origincoworks-gateway',
      config: {
        llm_proxy_url: 'https://api.xiaomao.chat',
        llm_proxy_key: 'k',
        primary_model: 'gpt-5.5',
        primary_provider: 'proxy-gpt',
        models: [],
      },
    });
    const refreshConnectionRuntime = spyOn(
      { refreshConnectionRuntime: async () => {} },
      'refreshConnectionRuntime',
    ).mockResolvedValue(undefined);
    const r = await ensureGatewayManagedLlmConnection({
      reinitializeAuth: async () => {},
      refreshConnectionRuntime,
    });
    expect(r.synced).toBe(true);
    expect(r.slug).toBe('origincoworks-gateway');
    expect(refreshConnectionRuntime).toHaveBeenCalledWith('origincoworks-gateway');
  });
});

describe('syncGatewayLlmConfigForSession', () => {
  let applySpy: ReturnType<typeof spyOn<typeof llmConfig, 'applyGatewayLlmConfigFromSession'>>;

  afterEach(() => {
    applySpy?.mockRestore();
  });

  it('refreshes live session runtimes after applying gateway LLM config', async () => {
    applySpy = spyOn(llmConfig, 'applyGatewayLlmConfigFromSession').mockResolvedValue({
      slug: 'origincoworks-gateway',
      config: {
        llm_proxy_url: 'https://api.xiaomao.chat',
        llm_proxy_key: 'k',
        primary_model: 'gpt-5.5',
        primary_provider: 'proxy-gpt',
        models: [],
      },
    });

    const refreshConnectionRuntime = spyOn(
      { refreshConnectionRuntime: async () => {} },
      'refreshConnectionRuntime',
    ).mockResolvedValue(undefined);

    const reinitializeAuth = spyOn(
      { reinitializeAuth: async () => {} },
      'reinitializeAuth',
    ).mockResolvedValue(undefined);

    const server: RpcServer = {
      handle() {},
      push() {},
      async invokeClient() {
        return undefined;
      },
      hasClientCapability() {
        return false;
      },
      findClientsWithCapability() {
        return [];
      },
    };

    const deps: HandlerDeps = {
      sessionManager: {
        reinitializeAuth,
        refreshConnectionRuntime,
      } as unknown as HandlerDeps['sessionManager'],
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

    const result = await syncGatewayLlmConfigForSession(server, deps);

    expect(result).toEqual({ success: true, slug: 'origincoworks-gateway', primaryModel: 'gpt-5.5' });
    expect(refreshConnectionRuntime).toHaveBeenCalledWith('origincoworks-gateway');
  });
});
