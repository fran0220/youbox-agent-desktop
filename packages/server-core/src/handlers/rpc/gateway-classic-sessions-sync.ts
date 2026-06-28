import { getWorkspaces } from '@craft-agent/shared/config';
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client';
import { getStoredGatewayToken, resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth';
import { syncClassicSessionsToWorkspace } from '@craft-agent/origincoworks/session-import';
import type { HandlerDeps } from '../handler-deps';

export async function syncGatewayClassicSessionsForSession(
  deps: HandlerDeps,
): Promise<
  | { success: true; summaries: number; materialized: number; skipped: number; errors: string[] }
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
    return { success: false, error: 'No workspaces configured to sync classic sessions into.' };
  }

  try {
    let summaries = 0;
    let materialized = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const workspaceRoot of workspaceRoots) {
      const result = await syncClassicSessionsToWorkspace(client, workspaceRoot);
      summaries = Math.max(summaries, result.summaries);
      materialized += result.materialized;
      skipped += result.skipped;
      errors.push(...result.errors);
    }
    log.info('[Gateway] Classic sessions sync complete', { summaries, materialized, skipped });
    return { success: true, summaries, materialized, skipped, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gateway classic sessions sync failed';
    log.error('[Gateway] Classic sessions sync failed:', message);
    return { success: false, error: message };
  }
}
