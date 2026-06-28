import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { RpcServer } from '@craft-agent/server-core/transport';
import {
  clearGatewaySession,
  getGatewaySessionState,
  loginGateway,
  logoutGateway,
  resolveGatewayBaseUrl,
} from '@craft-agent/origincoworks/auth';
import type { HandlerDeps } from '../handler-deps';
import { syncGatewayLlmConfigForSession } from './gateway-llm-sync.ts';
import { syncGatewaySkillsForSession } from './gateway-skills-sync.ts';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.gateway.GET_SESSION,
  RPC_CHANNELS.gateway.LOGIN,
  RPC_CHANNELS.gateway.LOGOUT,
  RPC_CHANNELS.gateway.SYNC_LLM_CONFIG,
  RPC_CHANNELS.gateway.SYNC_SKILLS,
] as const;

export function registerGatewayHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger;

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
      if (result.success) {
        log.info('[Gateway] User signed in:', result.user.name);
        const llmSync = await syncGatewayLlmConfigForSession(server, deps);
        if (!llmSync.success) {
          await clearGatewaySession();
          return { success: false as const, error: llmSync.error };
        }
        const skillsSync = await syncGatewaySkillsForSession(server, deps);
        if (!skillsSync.success) {
          log.warn('[Gateway] Skills sync after login failed:', skillsSync.error);
        }
      } else {
        log.info('[Gateway] Sign-in failed for user (no secrets logged)');
      }
      return result;
    },
  );

  server.handle(RPC_CHANNELS.gateway.SYNC_LLM_CONFIG, async () => {
    return syncGatewayLlmConfigForSession(server, deps);
  });

  server.handle(RPC_CHANNELS.gateway.SYNC_SKILLS, async () => {
    return syncGatewaySkillsForSession(server, deps);
  });
}
