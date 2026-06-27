import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { RpcServer } from '@craft-agent/server-core/transport';
import {
  getGatewaySessionState,
  loginGateway,
  resolveGatewayBaseUrl,
} from '@craft-agent/origincoworks/auth';
import type { HandlerDeps } from '../handler-deps';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.gateway.GET_SESSION,
  RPC_CHANNELS.gateway.LOGIN,
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
      return { authenticated: false as const };
    }
  });

  server.handle(
    RPC_CHANNELS.gateway.LOGIN,
    async (_ctx, payload: { username: string; password: string }) => {
      const username = payload?.username ?? '';
      const password = payload?.password ?? '';
      const result = await loginGateway(username, password, resolveGatewayBaseUrl());
      if (result.success) {
        log.info('[Gateway] User signed in:', result.user.name);
      } else {
        log.info('[Gateway] Sign-in failed for user (no secrets logged)');
      }
      return result;
    },
  );
}
