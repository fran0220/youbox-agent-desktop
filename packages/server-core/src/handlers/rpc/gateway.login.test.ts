import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport';
import * as gatewayAuth from '@craft-agent/origincoworks/auth';
import type { HandlerDeps } from '../handler-deps';
import { registerGatewayHandlers } from './gateway';
import * as gatewayPostAuth from './gateway-post-auth-sync.ts';
import * as gatewayClassicSync from './gateway-classic-sessions-sync.ts';

function createHarness() {
  const handlers = new Map<string, HandlerFn>();

  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
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
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
  };

  registerGatewayHandlers(server, deps);

  const login = handlers.get(RPC_CHANNELS.gateway.LOGIN);
  if (!login) {
    throw new Error('gateway LOGIN handler not registered');
  }
  const loginWithToken = handlers.get(RPC_CHANNELS.gateway.LOGIN_WITH_TOKEN);
  if (!loginWithToken) {
    throw new Error('gateway LOGIN_WITH_TOKEN handler not registered');
  }
  const feishuAuthUrl = handlers.get(RPC_CHANNELS.gateway.FEISHU_AUTH_URL);
  if (!feishuAuthUrl) {
    throw new Error('gateway FEISHU_AUTH_URL handler not registered');
  }

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: null,
    webContentsId: 1,
  };

  return { login, loginWithToken, feishuAuthUrl, ctx };
}

describe('registerGatewayHandlers gateway LOGIN', () => {
  let loginGatewaySpy: ReturnType<typeof spyOn<typeof gatewayAuth, 'loginGateway'>>;
  let loginGatewayWithTokenSpy: ReturnType<typeof spyOn<typeof gatewayAuth, 'loginGatewayWithToken'>>;
  let postAuthSpy: ReturnType<typeof spyOn<typeof gatewayPostAuth, 'syncGatewayStateAfterAuth'>>;
  let classicSyncSpy: ReturnType<typeof spyOn<typeof gatewayClassicSync, 'syncGatewayClassicSessionsForSession'>>;

  afterEach(() => {
    loginGatewaySpy?.mockRestore();
    loginGatewayWithTokenSpy?.mockRestore();
    postAuthSpy?.mockRestore();
    classicSyncSpy?.mockRestore();
  });

  it('forwards positional username and password to loginGateway (IPC seam)', async () => {
    loginGatewaySpy = spyOn(gatewayAuth, 'loginGateway').mockResolvedValue({
      success: true,
      user: { id: '1', name: 'octest', email: 'octest@local.test', role: 'admin' },
    });
    postAuthSpy = spyOn(gatewayPostAuth, 'syncGatewayStateAfterAuth').mockResolvedValue({
      llm: { success: true },
      memory: { success: true },
    });
    classicSyncSpy = spyOn(gatewayClassicSync, 'syncGatewayClassicSessionsForSession').mockResolvedValue({
      success: true,
      summaries: 0,
      materialized: 0,
      skipped: 0,
      errors: [],
    });

    const { login, ctx } = createHarness();

    const result = await login(ctx, 'octest', 'OcTest1234!');

    expect(loginGatewaySpy).toHaveBeenCalledTimes(1);
    expect(loginGatewaySpy.mock.calls[0]?.[0]).toBe('octest');
    expect(loginGatewaySpy.mock.calls[0]?.[1]).toBe('OcTest1234!');
    expect(typeof loginGatewaySpy.mock.calls[0]?.[2]).toBe('string');
    expect(result).toEqual({
      success: true,
      user: { id: '1', name: 'octest', email: 'octest@local.test', role: 'admin' },
    });
  });

  it('coalesces undefined positional args to empty strings', async () => {
    loginGatewaySpy = spyOn(gatewayAuth, 'loginGateway').mockResolvedValue({
      success: false,
      error: 'Username and password are required.',
    });

    const { login, ctx } = createHarness();

    await login(ctx, undefined as unknown as string, undefined as unknown as string);

    expect(loginGatewaySpy.mock.calls[0]?.[0]).toBe('');
    expect(loginGatewaySpy.mock.calls[0]?.[1]).toBe('');
  });

  it('builds Feishu auth URL from configured gateway base', async () => {
    const prev = process.env.ORIGINAI_GATEWAY_URL;
    process.env.ORIGINAI_GATEWAY_URL = 'https://jacoapi.jingao.club/';
    try {
      const { feishuAuthUrl, ctx } = createHarness();
      const result = await feishuAuthUrl(ctx, 'http://localhost:6477/admin/feishu/callback');

      expect(result).toEqual({
        authUrl: 'https://jacoapi.jingao.club/api/auth/feishu?redirect=http%3A%2F%2Flocalhost%3A6477%2Fadmin%2Ffeishu%2Fcallback',
      });
    } finally {
      if (prev === undefined) delete process.env.ORIGINAI_GATEWAY_URL;
      else process.env.ORIGINAI_GATEWAY_URL = prev;
    }
  });

  it('accepts gateway token login and runs post-auth sync', async () => {
    loginGatewayWithTokenSpy = spyOn(gatewayAuth, 'loginGatewayWithToken').mockResolvedValue({
      success: true,
      user: { id: '1', name: 'feishu-user', email: 'u@example.com', role: 'user' },
    });
    postAuthSpy = spyOn(gatewayPostAuth, 'syncGatewayStateAfterAuth').mockResolvedValue({
      llm: { success: true },
      memory: { success: true },
    });
    classicSyncSpy = spyOn(gatewayClassicSync, 'syncGatewayClassicSessionsForSession').mockResolvedValue({
      success: true,
      summaries: 0,
      materialized: 0,
      skipped: 0,
      errors: [],
    });

    const { loginWithToken, ctx } = createHarness();
    const token = 'b'.repeat(64);

    const result = await loginWithToken(ctx, token);

    expect(loginGatewayWithTokenSpy).toHaveBeenCalledTimes(1);
    expect(loginGatewayWithTokenSpy.mock.calls[0]?.[0]).toBe(token);
    expect(typeof loginGatewayWithTokenSpy.mock.calls[0]?.[1]).toBe('string');
    expect(postAuthSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      user: { id: '1', name: 'feishu-user', email: 'u@example.com', role: 'user' },
    });
  });
});
