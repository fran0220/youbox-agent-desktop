import { getWorkspaces } from '@craft-agent/shared/config';
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client';
import { getStoredGatewayToken, resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth';
import { syncGatewayMemoryToWorkspace } from '@craft-agent/origincoworks/memory-sync';
import type { HandlerDeps } from '../handler-deps';

export async function syncGatewayMemoryForSession(
  deps: HandlerDeps,
): Promise<
  | { success: true; pulled: number; pushed: number; skipped: boolean }
  | { success: false; error: string }
> {
  const log = deps.platform.logger;
  const token = await getStoredGatewayToken();
  if (!token) {
    return { success: false, error: 'Not signed in to the gateway.' };
  }

  const client = new GatewayClient(resolveGatewayBaseUrl(), token);
  const workspaceRoots = getWorkspaces()
    .map((w) => w.rootPath)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);

  if (workspaceRoots.length === 0) {
    return { success: false, error: 'No workspaces configured to sync memory into.' };
  }

  try {
    let pulled = 0;
    let pushed = 0;
    let skipped = true;
    for (const workspaceRoot of workspaceRoots) {
      const result = await syncGatewayMemoryToWorkspace({ client, workspaceRoot });
      pulled += result.pulled;
      pushed += result.pushed;
      skipped = skipped && result.skipped;
    }
    log.info('[Gateway] Memory sync complete', { pulled, pushed, skipped });
    return { success: true, pulled, pushed, skipped };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gateway memory sync failed';
    log.error('[Gateway] memory sync failed:', message);
    return { success: false, error: message };
  }
}
