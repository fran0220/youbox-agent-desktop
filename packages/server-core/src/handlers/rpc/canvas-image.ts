import { readFile, unlink } from 'fs/promises'
import { basename } from 'path'
import { randomUUID } from 'crypto'
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
import {
  addOrBackfillCanvasImageNode,
  isPathWithinWorkspace,
  loadCanvasDoc,
  writeCanvasAsset,
} from '../../canvas/canvas-storage'
import {
  generateImage,
  resolveImageConnection,
  type ImageReference,
} from '../../canvas/image-generation'

export const HANDLED_CHANNELS = [RPC_CHANNELS.canvas.GENERATE_IMAGE] as const

/**
 * Server-side generation timeout (ms). Kept strictly below the client's
 * per-channel invoke timeout for canvas:generateImage (180_000ms, see
 * CHANNEL_TIMEOUT_OVERRIDES_MS) so the server aborts and returns a clean
 * 'timeout' error before the client gives up on the request.
 */
const GENERATE_IMAGE_TIMEOUT_MS = 150_000

function fail(code: CanvasGenerateImageErrorCode, message: string): CanvasGenerateImageError {
  return { ok: false, code, message }
}

interface RefNode {
  id: string
  type?: string
  data?: { filePath?: string }
}

/**
 * Resolve reference image bytes from node ids (via the doc) and absolute paths.
 *
 * SECURITY: every path — both client-writable node.filePath and the arbitrary
 * absolute referenceImagePaths — is confined to the workspace via
 * {@link isPathWithinWorkspace} (realpath + symlink resolution) BEFORE it is
 * read. Any path that escapes the workspace is skipped, closing the local-file
 * read/exfil vector reachable through this handler (and the M4 agent tool).
 */
async function resolveReferences(
  workspaceRootPath: string,
  docNodes: RefNode[],
  req: CanvasGenerateImageRequest,
): Promise<ImageReference[]> {
  const paths: string[] = []
  for (const nodeId of req.referenceNodeIds ?? []) {
    const node = docNodes.find(n => n.id === nodeId)
    const filePath = node && node.type === 'image' ? node.data?.filePath : undefined
    if (typeof filePath === 'string' && filePath) paths.push(filePath)
  }
  for (const p of req.referenceImagePaths ?? []) {
    if (typeof p === 'string' && p) paths.push(p)
  }

  const refs: ImageReference[] = []
  for (const p of paths) {
    if (!(await isPathWithinWorkspace(workspaceRootPath, p))) {
      // Outside the workspace after symlink resolution — refuse to read it.
      continue
    }
    try {
      const data = await readFile(p)
      refs.push({ data, fileName: basename(p) || 'reference.png' })
    } catch {
      // Unresolvable reference — skip; generation degrades to the remaining refs
      // (or text-to-image when none resolve).
    }
  }
  return refs
}

export function registerCanvasImageHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(
    RPC_CHANNELS.canvas.GENERATE_IMAGE,
    async (_ctx, req: CanvasGenerateImageRequest): Promise<CanvasGenerateImageResult> => {
      if (!req || typeof req !== 'object') return fail('bad_request', 'missing request')
      if (!req.prompt || !req.prompt.trim()) return fail('bad_request', 'prompt is required')

      const workspace = getWorkspaceByNameOrId(req.workspaceId)
      if (!workspace) return fail('workspace_not_found', `Workspace not found: ${req.workspaceId}`)

      const doc = loadCanvasDoc(workspace.rootPath, req.docId)
      if (!doc) return fail('doc_not_found', `Canvas doc not found: ${req.docId}`)

      const connection = await resolveImageConnection()
      if (!connection) {
        return fail('no_connection', 'No image-capable LLM connection is configured')
      }

      const references = await resolveReferences(workspace.rootPath, doc.nodes as RefNode[], req)

      const outcome = await generateImage({
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey,
        model: connection.model,
        prompt: req.prompt,
        size: req.size,
        references,
        timeoutMs: GENERATE_IMAGE_TIMEOUT_MS,
      })

      if (!outcome.ok) {
        log.warn(`CANVAS_GENERATE_IMAGE: generation failed (${outcome.code}) for doc ${req.docId}`)
        return outcome
      }

      let assetPath: string
      let fileName: string
      try {
        fileName = `${randomUUID()}.png`
        assetPath = await writeCanvasAsset(workspace.rootPath, req.docId, fileName, Buffer.from(outcome.b64, 'base64'))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error(`CANVAS_GENERATE_IMAGE: failed to persist asset for doc ${req.docId}`)
        return fail('invalid_response', `failed to write image asset: ${message}`)
      }

      let nodeId: string
      try {
        const mutation = await addOrBackfillCanvasImageNode(workspace.rootPath, req.docId, {
          nodeId: req.nodeId,
          filePath: assetPath,
          fileName,
        })
        nodeId = mutation.nodeId
      } catch (error) {
        // The asset landed on disk but the doc mutation failed — roll the asset
        // back (best-effort) so it isn't orphaned, and surface a typed error
        // instead of a generic HANDLER_ERROR. No secrets in the message.
        try { await unlink(assetPath) } catch { /* best-effort cleanup */ }
        const message = error instanceof Error ? error.message : String(error)
        log.error(`CANVAS_GENERATE_IMAGE: doc mutation failed for doc ${req.docId}; rolled back asset`)
        return fail('persist_failed', `failed to attach image to canvas doc: ${message}`)
      }

      pushTyped(
        server,
        RPC_CHANNELS.canvas.CHANGED,
        { to: 'workspace', workspaceId: req.workspaceId },
        { workspaceId: req.workspaceId, docId: req.docId, kind: 'updated' },
      )

      log.info(
        `CANVAS_GENERATE_IMAGE: wrote asset for doc ${req.docId} (endpoint=${outcome.usedEndpoint}, refs=${references.length})`,
      )
      return { ok: true, nodeId, assetPath, imageFileName: fileName }
    },
  )
}
