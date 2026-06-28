import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { getWorkspaces } from '@craft-agent/shared/config';
import { loadAllSkills } from '@craft-agent/shared/skills';
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client';
import { getStoredGatewayToken, resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth';
import { syncGatewaySkillsToWorkspaces } from '@craft-agent/origincoworks/skills-sync';
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';

export async function syncGatewaySkillsForSession(
  server: RpcServer,
  deps: HandlerDeps,
): Promise<
  | { success: true; filesWritten: number; ownersPulled: string[] }
  | { success: false; error: string }
> {
  const log = deps.platform.logger;
  const token = await getStoredGatewayToken();
  if (!token) {
    return { success: false, error: 'Not signed in to the gateway.' };
  }

  const baseUrl = resolveGatewayBaseUrl();
  const client = new GatewayClient(baseUrl, token);
  let userId: string;
  try {
    const user = await client.me();
    userId = user.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gateway user lookup failed';
    log.error('[Gateway] skills sync: me() failed:', message);
    return { success: false, error: message };
  }

  const workspaceRoots = getWorkspaces()
    .map((w) => w.rootPath)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);

  if (workspaceRoots.length === 0) {
    return { success: false, error: 'No workspaces configured to sync skills into.' };
  }

  try {
    const result = await syncGatewaySkillsToWorkspaces({
      client,
      workspaceRoots,
      userId,
    });
    if (result.cacheInvalidated) {
      for (const ws of getWorkspaces()) {
        const skills = loadAllSkills(ws.rootPath);
        pushTyped(
          server,
          RPC_CHANNELS.skills.CHANGED,
          { to: 'workspace', workspaceId: ws.id },
          ws.id,
          skills,
        );
      }
    }
    log.info('[Gateway] Skills sync complete', {
      filesWritten: result.filesWritten,
      ownersPulled: result.ownersPulled,
      filesSkipped: result.filesSkipped,
    });
    return {
      success: true,
      filesWritten: result.filesWritten,
      ownersPulled: result.ownersPulled,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gateway skills sync failed';
    log.error('[Gateway] skills sync failed:', message);
    return { success: false, error: message };
  }
}
