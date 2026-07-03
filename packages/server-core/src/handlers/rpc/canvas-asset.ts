import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  CanvasImportAssetError,
  CanvasImportAssetErrorCode,
  CanvasImportAssetRequest,
  CanvasImportAssetResult,
} from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { importCanvasAsset } from '../../canvas/canvas-asset-service'

export const HANDLED_CHANNELS = [RPC_CHANNELS.canvas.IMPORT_ASSET] as const

function fail(code: CanvasImportAssetErrorCode, message: string): CanvasImportAssetError {
  return { ok: false, code, message }
}

export function registerCanvasAssetHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(
    RPC_CHANNELS.canvas.IMPORT_ASSET,
    async (_ctx, req: CanvasImportAssetRequest): Promise<CanvasImportAssetResult> => {
      if (!req || typeof req !== 'object') return fail('io_error', 'missing request')

      const workspace = getWorkspaceByNameOrId(req.workspaceId)
      if (!workspace) return fail('workspace_not_found', `Workspace not found: ${req.workspaceId}`)

      return importCanvasAsset(
        workspace.rootPath,
        { docId: req.docId, sourcePath: req.sourcePath },
        { logger: log },
      )
    },
  )
}
