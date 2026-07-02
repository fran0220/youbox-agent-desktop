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

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: null,
    webContentsId: 1,
  };

  return { login, ctx };
}

describe('registerGatewayHandlers gateway LOGIN', () => {
  let loginGatewaySpy: ReturnType<typeof spyOn<typeof gatewayAuth, 'loginGateway'>>;
  let postAuthSpy: ReturnType<typeof spyOn<typeof gatewayPostAuth, 'syncGatewayStateAfterAuth'>>;
  let classicSyncSpy: ReturnType<typeof spyOn<typeof gatewayClassicSync, 'syncGatewayClassicSessionsForSession'>>;

  afterEach(() => {
    loginGatewaySpy?.mockRestore();
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
});
