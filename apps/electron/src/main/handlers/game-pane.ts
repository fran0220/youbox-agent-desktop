import { RPC_CHANNELS } from '../../shared/types'
import type { GamePaneBounds } from '../../shared/types'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import { basename, join } from 'node:path'
import type { HandlerDeps } from './handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.gamePane.START,
  RPC_CHANNELS.gamePane.STOP,
  RPC_CHANNELS.gamePane.RELOAD,
  RPC_CHANNELS.gamePane.SET_BOUNDS,
  RPC_CHANNELS.gamePane.SET_VISIBLE,
  RPC_CHANNELS.gamePane.CAPTURE,
] as const

export function registerGamePaneHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { gameServerManager, platform } = deps
  if (!gameServerManager) return

  gameServerManager.setChangeListener(event => {
    if (!event.workspaceId) return
    pushTyped(
      server,
      RPC_CHANNELS.gamestudio.CHANGED,
      { to: 'workspace', workspaceId: event.workspaceId },
      { workspaceId: event.workspaceId, projectId: event.projectId, kind: event.kind },
    )
  })

  server.handle(RPC_CHANNELS.gamePane.START, async (_ctx, workspaceId: string, projectId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    try {
      return await gameServerManager.start(getGameProjectDir(workspace.rootPath, projectId), { workspaceId })
    } catch (err) {
      platform.logger.error(`[game-pane] start failed for ${projectId}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.gamePane.STOP, async (_ctx, projectId: string) => {
    try {
      await gameServerManager.stop(projectId)
    } catch (err) {
      platform.logger.error(`[game-pane] stop failed for ${projectId}:`, err)
      throw err
    }
  })

  // Pane operations are intentionally registered as safe no-ops in this feature.
  // GamePaneManager will replace these bodies with WebContentsView behavior.
  server.handle(RPC_CHANNELS.gamePane.RELOAD, () => {})
  server.handle(RPC_CHANNELS.gamePane.SET_BOUNDS, (_ctx, _projectId: string, _bounds: GamePaneBounds) => {})
  server.handle(RPC_CHANNELS.gamePane.SET_VISIBLE, (_ctx, _projectId: string, _visible: boolean) => {})
  server.handle(RPC_CHANNELS.gamePane.CAPTURE, () => null)
}

function getGameProjectDir(workspaceRootPath: string, projectId: string): string {
  if (!projectId || basename(projectId) !== projectId || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(projectId)) {
    throw new Error(`Invalid game project id: ${JSON.stringify(projectId)}`)
  }
  return join(workspaceRootPath, 'gamestudio', projectId)
}
