/**
 * Re-fetch LLM config and memory from the gateway after login or session restore.
 * Used by gateway LOGIN, WebUI per-user bootstrap, and SessionManager cold start.
 */
import { getStoredGatewayToken } from '@craft-agent/origincoworks/auth';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';
import { syncGatewayLlmConfigForSession, ensureGatewayManagedLlmConnection } from './gateway-llm-sync.ts';
import { syncGatewayMemoryForSession } from './gateway-memory-sync.ts';

export type GatewayPostAuthSyncResult = {
  llm: { success: boolean; error?: string };
  memory: { success: boolean; error?: string };
};

export async function syncGatewayStateAfterAuth(options: {
  sessionManager: HandlerDeps['sessionManager'];
  deps: HandlerDeps;
  rpcServer?: RpcServer | null;
}): Promise<GatewayPostAuthSyncResult> {
  const log = options.deps.platform.logger;
  const token = await getStoredGatewayToken();
  if (!token) {
    const err = 'Not signed in to the gateway.';
    return {
      llm: { success: false, error: err },
      memory: { success: false, error: err },
    };
  }

  const server = options.rpcServer ?? null;
  let llm: GatewayPostAuthSyncResult['llm'] = { success: true };

  if (server) {
    const llmSync = await syncGatewayLlmConfigForSession(server, options.deps);
    llm = llmSync.success
      ? { success: true }
      : { success: false, error: llmSync.error };
  } else {
    const ensured = await ensureGatewayManagedLlmConnection(options.sessionManager);
    if (ensured.error) {
      llm = { success: false, error: ensured.error };
    } else {
      llm = { success: true };
    }
  }

  const memorySync = await syncGatewayMemoryForSession(options.deps);
  const memory = memorySync.success
    ? { success: true }
    : { success: false, error: memorySync.error };

  if (!memorySync.success) {
    log.warn('[Gateway] Post-auth memory sync failed:', memorySync.error);
  }

  return { llm, memory };
}
