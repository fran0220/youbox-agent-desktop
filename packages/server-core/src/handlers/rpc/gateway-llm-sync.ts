import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import {
  applyGatewayLlmConfigFromSession,
  ORIGINCOWORKS_GATEWAY_LLM_SLUG,
} from '@craft-agent/origincoworks/llm-config';
import { getStoredGatewayToken, resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth';
import { getDefaultLlmConnection, getLlmConnection } from '@craft-agent/shared/config';
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';

type GatewayLlmSyncSessionManager = Pick<
  HandlerDeps['sessionManager'],
  'reinitializeAuth' | 'refreshConnectionRuntime'
>;

/**
 * When a gateway session token exists but the managed LLM connection is missing
 * (e.g. user authenticated before M4 autopopulate, or config reset), apply
 * /api/desktop/config before any chat session spawns a Pi subprocess.
 */
export async function ensureGatewayManagedLlmConnection(
  sessionManager: GatewayLlmSyncSessionManager,
): Promise<{ synced: boolean; slug?: string; error?: string }> {
  const token = await getStoredGatewayToken();
  if (!token) {
    return { synced: false };
  }

  const managed = getLlmConnection(ORIGINCOWORKS_GATEWAY_LLM_SLUG);
  const defaultSlug = getDefaultLlmConnection();
  if (managed && defaultSlug === ORIGINCOWORKS_GATEWAY_LLM_SLUG) {
    return { synced: false };
  }

  try {
    const { slug } = await applyGatewayLlmConfigFromSession(
      { reinitializeAuth: (s) => sessionManager.reinitializeAuth(s) },
      resolveGatewayBaseUrl(),
    );
    await sessionManager.refreshConnectionRuntime(slug);
    return { synced: true, slug };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gateway LLM ensure failed';
    return { synced: false, error: message };
  }
}

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
    await deps.sessionManager.refreshConnectionRuntime(slug);
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
