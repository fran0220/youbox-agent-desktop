import { existsSync } from 'fs'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { DesignProjectChangedKind, DesignProjectCreateInput, DesignProjectUpdateInput } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { PlatformServices } from '../../runtime/platform'
import type { HandlerDeps } from '../handler-deps'
import {
  createDesignProject,
  deleteDesignProject,
  listDesignProjects,
  loadDesignProject,
  updateDesignProject,
} from '../../design/design-project-storage'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.design.LIST,
  RPC_CHANNELS.design.GET,
  RPC_CHANNELS.design.CREATE,
  RPC_CHANNELS.design.UPDATE,
  RPC_CHANNELS.design.DELETE,
] as const

export function registerDesignHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  function broadcastChanged(workspaceId: string, projectId: string, kind: DesignProjectChangedKind): void {
    pushTyped(server, RPC_CHANNELS.design.CHANGED, { to: 'workspace', workspaceId }, { workspaceId, projectId, kind })
  }

  server.handle(RPC_CHANNELS.design.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`DESIGN_LIST: Workspace not found: ${workspaceId}`)
      return []
    }
    return listDesignProjects(workspace.rootPath)
  })

  server.handle(RPC_CHANNELS.design.GET, async (_ctx, workspaceId: string, projectId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`DESIGN_GET: Workspace not found: ${workspaceId}`)
      return null
    }
    return loadDesignProject(workspace.rootPath, projectId)
  })

  server.handle(RPC_CHANNELS.design.CREATE, async (_ctx, workspaceId: string, input?: DesignProjectCreateInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const createInput = input ?? {}
    const project = await createDesignProject(workspace.rootPath, createInput, {
      resourcesRoot: createInput.templateId || createInput.designSystemId ? resolveDesignResourcesRoot(deps.platform) : undefined,
    })
    log.info(`DESIGN_CREATE: Created design project ${project.id} in workspace ${workspaceId}`)
    broadcastChanged(workspaceId, project.id, 'created')
    return project
  })

  server.handle(RPC_CHANNELS.design.UPDATE, async (_ctx, workspaceId: string, projectId: string, patch: DesignProjectUpdateInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const project = await updateDesignProject(workspace.rootPath, projectId, patch ?? {})
    log.info(`DESIGN_UPDATE: Updated design project ${projectId} in workspace ${workspaceId}`)
    broadcastChanged(workspaceId, projectId, 'updated')
    return project
  })

  server.handle(RPC_CHANNELS.design.DELETE, async (_ctx, workspaceId: string, projectId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const deleted = await deleteDesignProject(workspace.rootPath, projectId)
    if (deleted) {
      log.info(`DESIGN_DELETE: Deleted design project ${projectId} in workspace ${workspaceId}`)
      broadcastChanged(workspaceId, projectId, 'deleted')
    }
  })
}

function uniqueCandidates(candidates: string[]): string[] {
  return [...new Set(candidates)]
}

export function getDesignResourcesRootCandidates(platform: Pick<PlatformServices, 'appRootPath' | 'resourcesPath' | 'isPackaged'>): string[] {
  return uniqueCandidates(platform.isPackaged
    ? [
        join(platform.appRootPath, 'dist', 'resources'),
        join(platform.appRootPath, 'resources'),
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

export function resolveDesignResourcesRoot(
  platform: PlatformServices,
  pathExists: (path: string) => boolean = existsSync,
): string {
  const candidates = getDesignResourcesRootCandidates(platform)
  const match = candidates.find(candidate => pathExists(join(candidate, 'design', 'manifest.json')))
  if (!match) {
    throw new Error(`Design resources not found. Tried: ${candidates.join(', ')}`)
  }
  return match
}
