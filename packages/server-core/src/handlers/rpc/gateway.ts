import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { RpcServer } from '@craft-agent/server-core/transport';
import {
  buildGatewayFeishuAuthUrl,
  clearGatewaySession,
  type GatewayLoginResult,
  getGatewaySessionState,
  loginGateway,
  loginGatewayWithToken,
  logoutGateway,
  resolveGatewayBaseUrl,
} from '@craft-agent/origincoworks/auth';
import type { HandlerDeps } from '../handler-deps';
import { syncGatewayLlmConfigForSession } from './gateway-llm-sync.ts';
import { syncGatewayMemoryForSession } from './gateway-memory-sync.ts';
import { syncGatewayClassicSessionsForSession } from './gateway-classic-sessions-sync.ts';
import { syncGatewayStateAfterAuth } from './gateway-post-auth-sync.ts';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.gateway.FEISHU_AUTH_URL,
  RPC_CHANNELS.gateway.GET_SESSION,
  RPC_CHANNELS.gateway.LOGIN,
  RPC_CHANNELS.gateway.LOGIN_WITH_TOKEN,
  RPC_CHANNELS.gateway.LOGOUT,
  RPC_CHANNELS.gateway.SYNC_LLM_CONFIG,
  RPC_CHANNELS.gateway.SYNC_MEMORY,
  RPC_CHANNELS.gateway.SYNC_CLASSIC_SESSIONS,
] as const;

async function syncAfterSuccessfulGatewayAuth(
  result: GatewayLoginResult,
  server: RpcServer,
  deps: HandlerDeps,
  log: HandlerDeps['platform']['logger'],
): Promise<GatewayLoginResult> {
  if (!result.success) {
    log.info('[Gateway] Sign-in failed for user (no secrets logged)');
    return result;
  }

  log.info('[Gateway] User signed in:', result.user.name);
  const postAuth = await syncGatewayStateAfterAuth({
    sessionManager: deps.sessionManager,
    deps,
    rpcServer: server,
  });
  if (!postAuth.llm.success) {
    await clearGatewaySession();
    return { success: false as const, error: postAuth.llm.error ?? 'LLM sync failed' };
  }
  const classicSync = await syncGatewayClassicSessionsForSession(deps);
  if (!classicSync.success) {
    log.warn('[Gateway] Classic sessions sync after login failed:', classicSync.error);
  } else if (classicSync.summaries > 0 || classicSync.materialized > 0) {
    deps.sessionManager.reloadSessions();
  }

  return result;
}

export function registerGatewayHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger;

  server.handle(RPC_CHANNELS.gateway.FEISHU_AUTH_URL, async (_ctx, callbackUrl: string) => {
    return { authUrl: buildGatewayFeishuAuthUrl(callbackUrl ?? '', resolveGatewayBaseUrl()) };
  });

  server.handle(RPC_CHANNELS.gateway.GET_SESSION, async () => {
    const baseUrl = resolveGatewayBaseUrl();
    try {
      return await getGatewaySessionState(baseUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gateway session check failed';
      log.error('[Gateway] getSession failed:', message);
      return { authenticated: false as const, reason: 'no_token' as const };
    }
  });

  server.handle(RPC_CHANNELS.gateway.LOGOUT, async () => {
    const baseUrl = resolveGatewayBaseUrl();
    try {
      await logoutGateway(baseUrl);
      log.info('[Gateway] User signed out (server session revoked when possible)');
      return { success: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gateway logout failed';
      log.error('[Gateway] logout failed:', message);
      throw err;
    }
  });

  server.handle(
    RPC_CHANNELS.gateway.LOGIN,
    async (_ctx, username: string, password: string) => {
      const result = await loginGateway(username ?? '', password ?? '', resolveGatewayBaseUrl());
      return syncAfterSuccessfulGatewayAuth(result, server, deps, log);
    },
  );

  server.handle(
    RPC_CHANNELS.gateway.LOGIN_WITH_TOKEN,
    async (_ctx, token: string) => {
      const result = await loginGatewayWithToken(token ?? '', resolveGatewayBaseUrl());
      return syncAfterSuccessfulGatewayAuth(result, server, deps, log);
    },
  );

  server.handle(RPC_CHANNELS.gateway.SYNC_LLM_CONFIG, async () => {
    return syncGatewayLlmConfigForSession(server, deps);
  });

  server.handle(RPC_CHANNELS.gateway.SYNC_MEMORY, async () => {
    return syncGatewayMemoryForSession(deps);
  });

  server.handle(RPC_CHANNELS.gateway.SYNC_CLASSIC_SESSIONS, async () => {
    const result = await syncGatewayClassicSessionsForSession(deps);
    if (result.success && (result.summaries > 0 || result.materialized > 0)) {
      deps.sessionManager.reloadSessions();
    }
    return result;
  });
}
