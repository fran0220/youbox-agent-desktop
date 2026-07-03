import { existsSync } from 'fs'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { GameProjectChangedKind, GameProjectCreateInput, GameProjectUpdateInput } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { PlatformServices } from '../../runtime/platform'
import type { HandlerDeps } from '../handler-deps'
import {
  createGameProject,
  deleteGameProject,
  listGameProjects,
  loadGameProject,
  updateGameProject,
} from '../../gamestudio/game-project-storage'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.gamestudio.LIST,
  RPC_CHANNELS.gamestudio.GET,
  RPC_CHANNELS.gamestudio.CREATE,
  RPC_CHANNELS.gamestudio.UPDATE,
  RPC_CHANNELS.gamestudio.DELETE,
] as const

export function registerGameStudioHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  function broadcastChanged(workspaceId: string, projectId: string, kind: GameProjectChangedKind): void {
    pushTyped(server, RPC_CHANNELS.gamestudio.CHANGED, { to: 'workspace', workspaceId }, { workspaceId, projectId, kind })
  }

  server.handle(RPC_CHANNELS.gamestudio.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`GAMESTUDIO_LIST: Workspace not found: ${workspaceId}`)
      return []
    }
    return listGameProjects(workspace.rootPath)
  })

  server.handle(RPC_CHANNELS.gamestudio.GET, async (_ctx, workspaceId: string, projectId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`GAMESTUDIO_GET: Workspace not found: ${workspaceId}`)
      return null
    }
    return loadGameProject(workspace.rootPath, projectId)
  })

  server.handle(RPC_CHANNELS.gamestudio.CREATE, async (_ctx, workspaceId: string, input?: GameProjectCreateInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const project = await createGameProject(workspace.rootPath, input ?? {}, {
      resourcesRoot: resolveGameStudioResourcesRoot(deps.platform),
    })
    log.info(`GAMESTUDIO_CREATE: Created game project ${project.id} in workspace ${workspaceId}`)
    broadcastChanged(workspaceId, project.id, 'created')
    return project
  })

  server.handle(RPC_CHANNELS.gamestudio.UPDATE, async (_ctx, workspaceId: string, projectId: string, patch: GameProjectUpdateInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const project = await updateGameProject(workspace.rootPath, projectId, patch ?? {})
    log.info(`GAMESTUDIO_UPDATE: Updated game project ${projectId} in workspace ${workspaceId}`)
    broadcastChanged(workspaceId, projectId, 'updated')
    return project
  })

  server.handle(RPC_CHANNELS.gamestudio.DELETE, async (_ctx, workspaceId: string, projectId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const deleted = await deleteGameProject(workspace.rootPath, projectId)
    if (deleted) {
      log.info(`GAMESTUDIO_DELETE: Deleted game project ${projectId} in workspace ${workspaceId}`)
      broadcastChanged(workspaceId, projectId, 'deleted')
    }
  })
}

export function resolveGameStudioResourcesRoot(platform: PlatformServices): string {
  const candidates = platform.isPackaged
    ? [
        join(platform.resourcesPath, 'app', 'resources'),
        join(platform.appRootPath, 'resources'),
        join(platform.resourcesPath, 'resources'),
      ]
    : [
        join(platform.appRootPath, 'apps', 'electron', 'resources'),
        join(platform.appRootPath, 'resources'),
        join(process.cwd(), 'apps', 'electron', 'resources'),
      ]

  const match = candidates.find(candidate => existsSync(join(candidate, 'gamestudio', 'vendor', 'three.module.js')))
  if (!match) {
    throw new Error(`Game Studio resources not found. Tried: ${candidates.join(', ')}`)
  }
  return match
}
