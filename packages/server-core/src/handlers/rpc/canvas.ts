import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { CanvasChangedKind, CanvasDoc, CanvasDocCreateInput, CanvasDocUpdateInput } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  createCanvasDoc,
  deleteCanvasDoc,
  listCanvasDocs,
  loadCanvasDoc,
  setCanvasDocChatSessionId,
  updateCanvasDoc,
} from '../../canvas/canvas-storage'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.canvas.LIST,
  RPC_CHANNELS.canvas.GET,
  RPC_CHANNELS.canvas.CREATE,
  RPC_CHANNELS.canvas.UPDATE,
  RPC_CHANNELS.canvas.DELETE,
] as const

export function registerCanvasHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  function broadcastChanged(workspaceId: string, docId: string, kind: CanvasChangedKind): void {
    pushTyped(server, RPC_CHANNELS.canvas.CHANGED, { to: 'workspace', workspaceId }, { workspaceId, docId, kind })
  }

  // List canvas doc metadata for a workspace
  server.handle(RPC_CHANNELS.canvas.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`CANVAS_LIST: Workspace not found: ${workspaceId}`)
      return []
    }
    return listCanvasDocs(workspace.rootPath)
  })

  // Get a full canvas doc (meta + state), null if missing
  server.handle(RPC_CHANNELS.canvas.GET, async (_ctx, workspaceId: string, docId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`CANVAS_GET: Workspace not found: ${workspaceId}`)
      return null
    }
    return loadCanvasDoc(workspace.rootPath, docId)
  })

  // Create a new canvas doc
  server.handle(RPC_CHANNELS.canvas.CREATE, async (_ctx, workspaceId: string, input?: CanvasDocCreateInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const doc = await createCanvasDoc(workspace.rootPath, input ?? {})
    log.info(`CANVAS_CREATE: Created canvas doc ${doc.id} in workspace ${workspaceId}`)
    broadcastChanged(workspaceId, doc.id, 'created')
    return doc
  })

  // Update a canvas doc (name, state and/or hidden chat-session binding).
  // Last-write-wins on conflicts. `chatSessionId` is a metadata-only bind that
  // does NOT bump `version` and does NOT broadcast canvas:changed, so a session
  // bind never registers as a content change.
  server.handle(RPC_CHANNELS.canvas.UPDATE, async (_ctx, workspaceId: string, docId: string, patch: CanvasDocUpdateInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const input = patch ?? {}
    const hasContentChange = input.name !== undefined || input.state !== undefined

    let doc: CanvasDoc | null = null
    if (hasContentChange) {
      doc = await updateCanvasDoc(workspace.rootPath, docId, input)
    }
    if (input.chatSessionId !== undefined) {
      // Metadata-only bind — no version bump. Applied after any content change
      // so the returned doc reflects both.
      doc = await setCanvasDocChatSessionId(workspace.rootPath, docId, input.chatSessionId)
      // Late-binding: if the bound session's agent is already running, re-evaluate
      // its canvas tool availability so the canvas_* tools appear without a restart.
      if (input.chatSessionId) {
        deps.sessionManager.refreshCanvasToolsForSession?.(input.chatSessionId)
      }
    }
    if (!doc) {
      doc = loadCanvasDoc(workspace.rootPath, docId)
      if (!doc) throw new Error(`Canvas doc not found: ${docId}`)
    }

    if (hasContentChange) broadcastChanged(workspaceId, docId, 'updated')
    return doc
  })

  // Delete a canvas doc (and its assets dir). Idempotent.
  server.handle(RPC_CHANNELS.canvas.DELETE, async (_ctx, workspaceId: string, docId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    // Capture the bound hidden chat session (if any) before the doc file is
    // removed, so we can clean it up after a successful delete.
    const chatSessionId = loadCanvasDoc(workspace.rootPath, docId)?.chatSessionId

    const deleted = await deleteCanvasDoc(workspace.rootPath, docId)
    if (deleted) {
      log.info(`CANVAS_DELETE: Deleted canvas doc ${docId} in workspace ${workspaceId}`)
      if (chatSessionId) {
        // Best-effort: a failed session cleanup must not fail the doc delete.
        try {
          await deps.sessionManager.deleteSession(chatSessionId)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log.warn(`CANVAS_DELETE: failed to delete bound chat session for doc ${docId}: ${message}`)
        }
      }
      broadcastChanged(workspaceId, docId, 'deleted')
    }
  })
}
