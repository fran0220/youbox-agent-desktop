import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  CanvasGenerateImageError,
  CanvasGenerateImageErrorCode,
  CanvasGenerateImageRequest,
  CanvasGenerateImageResult,
} from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { generateCanvasImageAsset } from '../../canvas/canvas-image-service'

export const HANDLED_CHANNELS = [RPC_CHANNELS.canvas.GENERATE_IMAGE] as const

function fail(code: CanvasGenerateImageErrorCode, message: string): CanvasGenerateImageError {
  return { ok: false, code, message }
}

export function registerCanvasImageHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(
    RPC_CHANNELS.canvas.GENERATE_IMAGE,
    async (_ctx, req: CanvasGenerateImageRequest): Promise<CanvasGenerateImageResult> => {
      if (!req || typeof req !== 'object') return fail('bad_request', 'missing request')

      const workspace = getWorkspaceByNameOrId(req.workspaceId)
      if (!workspace) return fail('workspace_not_found', `Workspace not found: ${req.workspaceId}`)

      const result = await generateCanvasImageAsset(workspace.rootPath, req, { logger: log })

      if (result.ok) {
        pushTyped(
          server,
          RPC_CHANNELS.canvas.CHANGED,
          { to: 'workspace', workspaceId: req.workspaceId },
          { workspaceId: req.workspaceId, docId: req.docId, kind: 'updated' },
        )
      }
      return result
    },
  )
}
