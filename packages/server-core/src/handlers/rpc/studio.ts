import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { StudioRecentArtifact } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { listCanvasDocs } from '../../canvas/canvas-storage'
import { listDesignProjects } from '../../design/design-project-storage'
import { listGameProjects } from '../../gamestudio/game-project-storage'

export const HANDLED_CHANNELS = [RPC_CHANNELS.studio.LIST_RECENTS] as const

export function registerStudioHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.studio.LIST_RECENTS, async (_ctx, workspaceId: string): Promise<StudioRecentArtifact[]> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`STUDIO_LIST_RECENTS: Workspace not found: ${workspaceId}`)
      return []
    }

    const [canvasDocs, designProjects, gameProjects] = await Promise.all([
      Promise.resolve(listCanvasDocs(workspace.rootPath)),
      Promise.resolve(listDesignProjects(workspace.rootPath)),
      Promise.resolve(listGameProjects(workspace.rootPath)),
    ])

    return [
      ...canvasDocs.map((doc): StudioRecentArtifact => ({
        kind: 'canvas',
        id: doc.id,
        name: doc.name,
        sessionId: doc.chatSessionId ?? null,
        thumbnailPath: null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        version: doc.version,
      })),
      ...designProjects.map((project): StudioRecentArtifact => ({
        kind: 'design',
        id: project.id,
        name: project.name,
        sessionId: project.sessionId,
        thumbnailPath: project.thumbnailPath,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        version: project.version,
      })),
      ...gameProjects.map((project): StudioRecentArtifact => ({
        kind: 'game',
        id: project.id,
        name: project.name,
        sessionId: project.sessionId,
        thumbnailPath: project.thumbnailPath,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        version: project.version,
      })),
    ].sort((a, b) => b.updatedAt - a.updatedAt)
  })
}
