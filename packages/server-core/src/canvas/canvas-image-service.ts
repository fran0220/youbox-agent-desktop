/**
 * Reusable canvas image-generation orchestration.
 *
 * Shared by the canvas:generateImage RPC handler and the canvas_generate_image
 * agent tool so generation logic (connection resolution, workspace-confined
 * reference reads, asset persistence, node backfill, orphan rollback) lives in
 * exactly one place. The caller is responsible for broadcasting canvas:changed
 * on success — this function performs no broadcast.
 */

import { readFile, unlink } from 'fs/promises'
import { basename } from 'path'
import { randomUUID } from 'crypto'
import type {
  CanvasGenerateImageError,
  CanvasGenerateImageErrorCode,
  CanvasGenerateImageRequest,
  CanvasGenerateImageResult,
} from '@craft-agent/shared/protocol'
import {
  addOrBackfillCanvasImageNode,
  isPathWithinWorkspace,
  loadCanvasDoc,
  writeCanvasAsset,
} from './canvas-storage'
import {
  generateImage,
  resolveImageConnection,
  type ImageReference,
  type ResolvedImageConnection,
} from './image-generation'

/**
 * Server-side generation timeout (ms). Kept strictly below the client's
 * per-channel invoke timeout for canvas:generateImage (180_000ms) so the server
 * aborts and returns a clean 'timeout' error before the client gives up.
 */
export const GENERATE_IMAGE_TIMEOUT_MS = 150_000

export interface CanvasImageGenerationDeps {
  /** Override the connection resolver (tests inject a fixed connection). */
  connectionResolver?: () => Promise<ResolvedImageConnection | null>
  /** Override fetch (tests inject a mock at the generation boundary). */
  fetchImpl?: typeof fetch
  /** Generation timeout override. */
  timeoutMs?: number
  logger?: { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void }
}

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
 * read/exfil vector reachable through the handler AND the agent tool.
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
      // Unresolvable reference — skip; generation degrades to the remaining refs.
    }
  }
  return refs
}

/**
 * Generate an image into a canvas doc and persist it (asset + image node).
 * Returns a typed result; never throws for expected failure modes, and never
 * leaks secrets in messages. Does NOT broadcast — the caller broadcasts
 * canvas:changed on `{ ok: true }`.
 */
export async function generateCanvasImageAsset(
  workspaceRootPath: string,
  req: CanvasGenerateImageRequest,
  deps: CanvasImageGenerationDeps = {},
): Promise<CanvasGenerateImageResult> {
  const log = deps.logger
  if (!req.prompt || !req.prompt.trim()) return fail('bad_request', 'prompt is required')

  const doc = loadCanvasDoc(workspaceRootPath, req.docId)
  if (!doc) return fail('doc_not_found', `Canvas doc not found: ${req.docId}`)

  const connection = await (deps.connectionResolver ?? resolveImageConnection)()
  if (!connection) return fail('no_connection', 'No image-capable LLM connection is configured')

  const references = await resolveReferences(workspaceRootPath, doc.nodes as RefNode[], req)

  const outcome = await generateImage({
    baseUrl: connection.baseUrl,
    apiKey: connection.apiKey,
    model: connection.model,
    prompt: req.prompt,
    size: req.size,
    references,
    timeoutMs: deps.timeoutMs ?? GENERATE_IMAGE_TIMEOUT_MS,
    fetchImpl: deps.fetchImpl,
  })

  if (!outcome.ok) {
    log?.warn?.(`CANVAS_GENERATE_IMAGE: generation failed (${outcome.code}) for doc ${req.docId}`)
    return outcome
  }

  let assetPath: string
  let fileName: string
  try {
    fileName = `${randomUUID()}.png`
    assetPath = await writeCanvasAsset(workspaceRootPath, req.docId, fileName, Buffer.from(outcome.b64, 'base64'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log?.error?.(`CANVAS_GENERATE_IMAGE: failed to persist asset for doc ${req.docId}`)
    return fail('invalid_response', `failed to write image asset: ${message}`)
  }

  let nodeId: string
  try {
    const mutation = await addOrBackfillCanvasImageNode(workspaceRootPath, req.docId, {
      nodeId: req.nodeId,
      filePath: assetPath,
      fileName,
    })
    nodeId = mutation.nodeId
  } catch (error) {
    // Asset landed on disk but the doc mutation failed — roll the asset back
    // (best-effort) so it isn't orphaned, and surface a typed error.
    try { await unlink(assetPath) } catch { /* best-effort cleanup */ }
    const message = error instanceof Error ? error.message : String(error)
    log?.error?.(`CANVAS_GENERATE_IMAGE: doc mutation failed for doc ${req.docId}; rolled back asset`)
    return fail('persist_failed', `failed to attach image to canvas doc: ${message}`)
  }

  log?.info?.(
    `CANVAS_GENERATE_IMAGE: wrote asset for doc ${req.docId} (endpoint=${outcome.usedEndpoint}, refs=${references.length})`,
  )
  return { ok: true, nodeId, assetPath, imageFileName: fileName }
}
