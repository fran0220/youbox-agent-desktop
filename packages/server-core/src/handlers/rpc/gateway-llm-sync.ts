import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { applyGatewayLlmConfigFromSession } from '@craft-agent/origincoworks/llm-config';
import { resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth';
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';

export async function syncGatewayLlmConfigForSession(
  server: RpcServer,
  deps: HandlerDeps,
): Promise<{ success: true; slug: string; primaryModel: string } | { success: false; error: string }> {
  const log = deps.platform.logger;
  try {
    const { slug, config } = await applyGatewayLlmConfigFromSession(
      { reinitializeAuth: (s) => deps.sessionManager.reinitializeAuth(s) },
      resolveGatewayBaseUrl(),
    );
    pushTyped(server, RPC_CHANNELS.llmConnections.CHANGED, { to: 'all' });
    log.info('[Gateway] Synced LLM config from desktop config API', {
      slug,
      primaryModel: config.primary_model,
    });
    return { success: true, slug, primaryModel: config.primary_model };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gateway LLM sync failed';
    log.error('[Gateway] LLM config sync failed:', message);
    return { success: false, error: message };
  }
}
