/**
 * Canvas Tool Service
 *
 * Server-core implementation of the shared CanvasToolFns interface used by the
 * session-scoped canvas_* agent tools. Every mutation goes through the SAME
 * canvas storage service the RPC handlers use (so writes are atomic + serialized
 * per doc) and emits a canvas:changed broadcast via the injected callback so the
 * canvas UI updates live.
 *
 * Session <-> doc binding: a canvas session is the hidden selection-chat session
 * bound to a doc via CanvasDocMeta.chatSessionId. We resolve "which doc does this
 * session drive?" by scanning the workspace's canvas docs for the one whose
 * chatSessionId === sessionId (see {@link resolveDocIdForSession}). This keeps
 * the doc as the single source of truth for the binding (no separate map to keep
 * in sync) and is resolved lazily on every tool call so re-binding is picked up.
 */

import { basename } from 'path'
import type {
  CanvasToolFns,
  CanvasCreateNodeParams,
  CanvasUpdateNodeParams,
  CanvasConnectParams,
  CanvasGenerateImageParams,
  CanvasListResult,
  CanvasNodeSummary,
} from '@craft-agent/shared/agent'
import type { CanvasChangedKind, CanvasNodeDto } from '@craft-agent/shared/protocol'
import {
  addCanvasEdge,
  addCanvasNode,
  isPathWithinWorkspace,
  listCanvasDocs,
  loadCanvasDoc,
  updateCanvasNode,
} from './canvas-storage'
import { generateCanvasImageAsset, type CanvasImageGenerationDeps } from './canvas-image-service'

/** Max characters accepted for a text node's content (sanity cap). */
const MAX_TEXT_LENGTH = 20_000

/**
 * Resolve the canvas doc a session drives by scanning the workspace's docs for
 * the one bound to this session (chatSessionId === sessionId). Returns null when
 * the session is not bound to any doc.
 */
export function resolveDocIdForSession(workspaceRootPath: string, sessionId: string): string | null {
  for (const meta of listCanvasDocs(workspaceRootPath)) {
    if (meta.chatSessionId === sessionId) return meta.id
  }
  return null
}

export interface CanvasToolServiceOptions {
  sessionId: string
  workspaceId: string
  workspaceRootPath: string
  /** Emit canvas:changed for a tool-driven mutation (same event the RPC handlers push). */
  broadcastChanged: (docId: string, kind: CanvasChangedKind) => void
  /** Injectable generation deps (tests supply a connection resolver + mock fetch). */
  imageGenerationDeps?: CanvasImageGenerationDeps
  /** Override doc resolution (tests). Defaults to reverse-scan by chatSessionId. */
  resolveDocId?: () => string | null
}

function toNodeSummary(node: CanvasNodeDto): CanvasNodeSummary {
  const extra = node as CanvasNodeDto & { width?: number; height?: number }
  const summary: CanvasNodeSummary = {
    id: node.id,
    type: node.type,
    position: node.position,
  }
  if (typeof extra.width === 'number') summary.width = extra.width
  if (typeof extra.height === 'number') summary.height = extra.height
  if (node.type === 'text') summary.text = node.data?.text
  else summary.fileName = node.data?.fileName
  return summary
}

export function createCanvasToolFns(options: CanvasToolServiceOptions): CanvasToolFns {
  const { workspaceRootPath, sessionId, broadcastChanged } = options

  function requireDocId(): string {
    const docId = options.resolveDocId
      ? options.resolveDocId()
      : resolveDocIdForSession(workspaceRootPath, sessionId)
    if (!docId) {
      throw new Error('This session is not bound to a canvas document.')
    }
    return docId
  }

  return {
    async listNodes(): Promise<CanvasListResult> {
      const docId = requireDocId()
      const doc = loadCanvasDoc(workspaceRootPath, docId)
      if (!doc) throw new Error(`Canvas doc not found: ${docId}`)
      return {
        docId: doc.id,
        docName: doc.name,
        nodes: doc.nodes.map(toNodeSummary),
        edges: doc.edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
      }
    },

    async createNode(params: CanvasCreateNodeParams): Promise<{ nodeId: string; type: 'image' | 'text' }> {
      const docId = requireDocId()
      const position = { x: params.x ?? 0, y: params.y ?? 0 }

      if (params.type === 'text') {
        const text = params.text ?? ''
        if (text.length > MAX_TEXT_LENGTH) {
          throw new Error(`Text exceeds the ${MAX_TEXT_LENGTH}-character limit`)
        }
        const { nodeId } = await addCanvasNode(workspaceRootPath, docId, {
          type: 'text',
          position,
          data: { text },
        })
        broadcastChanged(docId, 'updated')
        return { nodeId, type: 'text' }
      }

      // Image node — confine the source path to the workspace (no arbitrary FS reads).
      const imagePath = params.imagePath
      if (!imagePath) throw new Error("type='image' requires an 'imagePath' value")
      if (!(await isPathWithinWorkspace(workspaceRootPath, imagePath))) {
        throw new Error('Image path is outside the workspace or does not exist')
      }
      const { nodeId } = await addCanvasNode(workspaceRootPath, docId, {
        type: 'image',
        position,
        data: { filePath: imagePath, fileName: basename(imagePath) || 'image.png' },
      })
      broadcastChanged(docId, 'updated')
      return { nodeId, type: 'image' }
    },

    async updateNode(params: CanvasUpdateNodeParams): Promise<{ nodeId: string }> {
      const docId = requireDocId()
      if (params.text !== undefined && params.text.length > MAX_TEXT_LENGTH) {
        throw new Error(`Text exceeds the ${MAX_TEXT_LENGTH}-character limit`)
      }
      const patch: { position?: { x: number; y: number }; text?: string; width?: number; height?: number } = {}
      if (params.x !== undefined || params.y !== undefined) {
        const doc = loadCanvasDoc(workspaceRootPath, docId)
        const current = doc?.nodes.find(n => n.id === params.nodeId)
        if (!current) throw new Error(`Canvas node not found: ${params.nodeId}`)
        patch.position = {
          x: params.x ?? current.position.x,
          y: params.y ?? current.position.y,
        }
      }
      if (params.text !== undefined) patch.text = params.text
      if (params.width !== undefined) patch.width = params.width
      if (params.height !== undefined) patch.height = params.height

      const { nodeId } = await updateCanvasNode(workspaceRootPath, docId, params.nodeId, patch)
      broadcastChanged(docId, 'updated')
      return { nodeId }
    },

    async connect(params: CanvasConnectParams): Promise<{ edgeId: string }> {
      const docId = requireDocId()
      const { edgeId } = await addCanvasEdge(workspaceRootPath, docId, {
        source: params.source,
        target: params.target,
      })
      broadcastChanged(docId, 'updated')
      return { edgeId }
    },

    async generateImage(params: CanvasGenerateImageParams): Promise<{ nodeId: string; imageFileName: string }> {
      const docId = requireDocId()
      const result = await generateCanvasImageAsset(
        workspaceRootPath,
        {
          workspaceId: options.workspaceId,
          docId,
          prompt: params.prompt,
          size: params.size,
          nodeId: params.nodeId,
          referenceNodeIds: params.referenceNodeIds,
        },
        options.imageGenerationDeps ?? {},
      )
      if (!result.ok) {
        throw new Error(`image generation failed (${result.code}): ${result.message}`)
      }
      broadcastChanged(docId, 'updated')
      return { nodeId: result.nodeId, imageFileName: result.imageFileName }
    },
  }
}
