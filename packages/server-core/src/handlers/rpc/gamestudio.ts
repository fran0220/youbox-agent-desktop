import { existsSync } from 'fs'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { GameProjectChangedKind, GameProjectCreateInput, GameProjectUpdateInput } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { PlatformServices } from '../../runtime/platform'
import type { HandlerDeps } from '../handler-deps'
import {
  checkpointGameProject,
  createGameProject,
  deleteGameProject,
  listGameProjects,
  loadGameProject,
  restoreGameProject,
  updateGameProject,
} from '../../gamestudio/game-project-storage'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.gamestudio.LIST,
  RPC_CHANNELS.gamestudio.GET,
  RPC_CHANNELS.gamestudio.CREATE,
  RPC_CHANNELS.gamestudio.UPDATE,
  RPC_CHANNELS.gamestudio.DELETE,
  RPC_CHANNELS.gamestudio.CHECKPOINT,
  RPC_CHANNELS.gamestudio.RESTORE,
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

  server.handle(RPC_CHANNELS.gamestudio.CHECKPOINT, async (_ctx, workspaceId: string, projectId: string, playable?: boolean) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const result = await checkpointGameProject(workspace.rootPath, projectId, !!playable)
    if (result.commit) broadcastChanged(workspaceId, projectId, 'updated')
    return result
  })

  server.handle(RPC_CHANNELS.gamestudio.RESTORE, async (_ctx, workspaceId: string, projectId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const project = await restoreGameProject(workspace.rootPath, projectId)
    if (project) broadcastChanged(workspaceId, projectId, 'updated')
    return project
  })
}

function uniqueCandidates(candidates: string[]): string[] {
  return [...new Set(candidates)]
}

export function getGameStudioResourcesRootCandidates(platform: Pick<PlatformServices, 'appRootPath' | 'resourcesPath' | 'isPackaged'>): string[] {
  return uniqueCandidates(platform.isPackaged
    ? [
        // electron-builder includes build:copy output via `files: dist/**/*`.
        // With `asar: false`, app.getAppPath() points at Resources/app, so
        // bundled Game Studio assets live under Resources/app/dist/resources.
        join(platform.appRootPath, 'dist', 'resources'),
        // Platform-specific extraResources mappings in electron-builder.yml use
        // `to: app/...`; keep this sibling fallback aligned with that layout.
        join(platform.appRootPath, 'resources'),
        // If a future build flips ASAR back on, app.getAppPath() may be
        // Resources/app.asar while extraResources still target Resources/app.
        join(platform.resourcesPath, 'app', 'dist', 'resources'),
        join(platform.resourcesPath, 'app', 'resources'),
      ]
    : [
        join(platform.appRootPath, 'apps', 'electron', 'resources'),
        join(platform.appRootPath, 'apps', 'electron', 'dist', 'resources'),
        join(platform.appRootPath, 'resources'),
        join(platform.appRootPath, 'dist', 'resources'),
        join(process.cwd(), 'apps', 'electron', 'resources'),
        join(process.cwd(), 'apps', 'electron', 'dist', 'resources'),
      ])
}

export function resolveGameStudioResourcesRoot(
  platform: PlatformServices,
  pathExists: (path: string) => boolean = existsSync,
): string {
  const candidates = getGameStudioResourcesRootCandidates(platform)
  const match = candidates.find(candidate => pathExists(join(candidate, 'gamestudio', 'vendor', 'three.module.js')))
  if (!match) {
    throw new Error(`Game Studio resources not found. Tried: ${candidates.join(', ')}`)
  }
  return match
}
