/**
 * Canvas Atoms
 *
 * Jotai state for the current canvas document shown in canvas mode:
 * React Flow nodes/edges, viewport and derived selection. React Flow change
 * handlers write back through the apply* atoms so the atoms stay the single
 * source of truth. CanvasPage hydrates the atoms from canvas:get and
 * autosaves them back through canvas:update (serialize/deserialize below).
 */

import { atom } from 'jotai'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type Viewport,
  type XYPosition,
} from '@xyflow/react'
import type {
  CanvasDocMeta,
  CanvasDocState as CanvasDocStateDto,
  CanvasEdgeDto,
  CanvasNodeDto,
} from '@craft-agent/shared/protocol'
import {
  normalizeStalePendingNodes,
  setImageNodeError,
  setImageNodePending,
  setImageNodeReady,
} from '@/lib/canvas-generation'

// ============================================================================
// Types
// ============================================================================

/** Generation lifecycle of an image node (absent = a committed image) */
export type CanvasImageGenerationStatus = 'pending' | 'error'

export type CanvasImageNodeData = {
  /** Absolute path to the image file on disk (rendered via thumbnail://) */
  filePath: string
  /** Basename of the file, shown as the node caption */
  fileName: string
  /** Set while a generation is in flight ('pending') or failed ('error') */
  status?: CanvasImageGenerationStatus
  /** Prompt used to generate this node (retained for retry + chat context) */
  prompt?: string
  /** Error message shown in the error state (never contains secrets) */
  error?: string
  /** Reference node ids used for image-to-image (retained for retry) */
  referenceNodeIds?: string[]
}

export type CanvasTextNodeData = {
  /** Free-form text / prompt content of the note */
  text: string
}

export type CanvasImageNode = Node<CanvasImageNodeData, 'image'>
export type CanvasTextNode = Node<CanvasTextNodeData, 'text'>
export type CanvasNode = CanvasImageNode | CanvasTextNode
export type CanvasEdge = Edge

/** Serializable snapshot of the current canvas document (M2 persistence shape) */
export type CanvasDocState = {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: Viewport
}

// ============================================================================
// Pure helpers
// ============================================================================

function newElementId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

/** Basename that works for both POSIX and Windows absolute paths */
function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

export function createImageNode(filePath: string, position: XYPosition): CanvasImageNode {
  return {
    id: newElementId('image'),
    type: 'image',
    position,
    data: { filePath, fileName: fileNameFromPath(filePath) },
  }
}

export function createTextNode(position: XYPosition, text = ''): CanvasTextNode {
  return {
    id: newElementId('text'),
    type: 'text',
    position,
    data: { text },
  }
}

/**
 * Validates an edge connection attempt:
 * - both endpoints must be present
 * - no self-loops
 * - no duplicate of an existing edge (same endpoints AND same handle pair;
 *   undefined and null handles are equivalent)
 */
export function isValidCanvasConnection(
  connection: Connection,
  edges: readonly CanvasEdge[],
): boolean {
  const { source, target } = connection
  if (!source || !target) return false
  if (source === target) return false
  const sourceHandle = connection.sourceHandle ?? null
  const targetHandle = connection.targetHandle ?? null
  return !edges.some(
    (edge) =>
      edge.source === source &&
      edge.target === target &&
      (edge.sourceHandle ?? null) === sourceHandle &&
      (edge.targetHandle ?? null) === targetHandle,
  )
}

/**
 * Serializes the in-memory doc into the wire shape for canvas:update.
 * Strips volatile interaction flags (selection/drag state) so they neither
 * persist across restarts nor produce spurious dirty states.
 */
export function serializeCanvasDocState(state: CanvasDocState): CanvasDocStateDto {
  return {
    nodes: state.nodes.map(
      ({ selected: _selected, dragging: _dragging, ...node }) => node as unknown as CanvasNodeDto,
    ),
    edges: state.edges.map(
      ({ selected: _selected, ...edge }) => edge as unknown as CanvasEdgeDto,
    ),
    viewport: { x: state.viewport.x, y: state.viewport.y, zoom: state.viewport.zoom },
  }
}

/** Inverse of serializeCanvasDocState — wire shape back into React Flow types */
export function deserializeCanvasDocState(dto: CanvasDocStateDto): CanvasDocState {
  return {
    // A persisted 'pending' node has no live generation behind it, so it is
    // demoted to a retryable error instead of rendering an eternal spinner.
    nodes: normalizeStalePendingNodes(dto.nodes as unknown as CanvasNode[]),
    edges: dto.edges as unknown as CanvasEdge[],
    viewport: { x: dto.viewport.x, y: dto.viewport.y, zoom: dto.viewport.zoom },
  }
}

// ============================================================================
// Base atoms (current in-memory doc)
// ============================================================================

export const canvasNodesAtom = atom<CanvasNode[]>([])
export const canvasEdgesAtom = atom<CanvasEdge[]>([])
export const canvasViewportAtom = atom<Viewport>({ x: 0, y: 0, zoom: 1 })

/**
 * Workspace canvas doc list (metadata only). null until the first canvas:list
 * resolves so consumers can distinguish "loading" from "no docs". AppShell
 * populates it and keeps it fresh via canvas:changed.
 */
export const canvasDocsAtom = atom<CanvasDocMeta[] | null>(null)

/** Image node being previewed full-size (double-click), null when closed */
export const canvasImagePreviewAtom = atom<CanvasImageNodeData | null>(null)

// ============================================================================
// Derived atoms
// ============================================================================

/** Snapshot of the whole doc — what M2 will persist/hydrate */
export const canvasDocStateAtom = atom<CanvasDocState>((get) => ({
  nodes: get(canvasNodesAtom),
  edges: get(canvasEdgesAtom),
  viewport: get(canvasViewportAtom),
}))

export const selectedCanvasNodeIdsAtom = atom<string[]>((get) =>
  get(canvasNodesAtom).filter((node) => node.selected).map((node) => node.id),
)

export const canvasNodeCountAtom = atom<number>((get) => get(canvasNodesAtom).length)

// ============================================================================
// Write atoms (React Flow handlers + toolbar actions write through these)
// ============================================================================

/** Replaces the whole in-memory doc (used when loading/reconciling a canvas doc) */
export const hydrateCanvasDocAtom = atom(null, (_get, set, state: CanvasDocState) => {
  set(canvasNodesAtom, state.nodes)
  set(canvasEdgesAtom, state.edges)
  set(canvasViewportAtom, state.viewport)
})

export const applyCanvasNodeChangesAtom = atom(
  null,
  (get, set, changes: NodeChange<CanvasNode>[]) => {
    set(canvasNodesAtom, applyNodeChanges(changes, get(canvasNodesAtom)))
  },
)

export const applyCanvasEdgeChangesAtom = atom(
  null,
  (get, set, changes: EdgeChange<CanvasEdge>[]) => {
    set(canvasEdgesAtom, applyEdgeChanges(changes, get(canvasEdgesAtom)))
  },
)

/** Adds an edge for a connection attempt; silently ignores invalid ones */
export const connectCanvasEdgeAtom = atom(null, (get, set, connection: Connection) => {
  const edges = get(canvasEdgesAtom)
  if (!isValidCanvasConnection(connection, edges)) return
  set(canvasEdgesAtom, addEdge(connection, edges))
})

export const addCanvasNodeAtom = atom(null, (get, set, node: CanvasNode) => {
  set(canvasNodesAtom, [...get(canvasNodesAtom), node])
})

/** Commits edited text into a text node (no-op for other node types/ids) */
export const setTextNodeTextAtom = atom(
  null,
  (get, set, { id, text }: { id: string; text: string }) => {
    set(
      canvasNodesAtom,
      get(canvasNodesAtom).map((node) =>
        node.id === id && node.type === 'text' ? { ...node, data: { ...node.data, text } } : node,
      ),
    )
  },
)

// ============================================================================
// Image generation write atoms (M3)
// ============================================================================

/** Flip an image node to the pending (spinner) state — generate + retry */
export const markCanvasImageNodePendingAtom = atom(
  null,
  (get, set, params: { id: string; prompt?: string; referenceNodeIds?: string[] }) => {
    set(canvasNodesAtom, setImageNodePending(get(canvasNodesAtom), params.id, params))
  },
)

/** Mark an image node's generation as failed (retryable error state) */
export const markCanvasImageNodeErrorAtom = atom(
  null,
  (get, set, params: { id: string; message: string }) => {
    set(canvasNodesAtom, setImageNodeError(get(canvasNodesAtom), params.id, params.message))
  },
)

/** Optimistically commit a generated asset onto the placeholder image node */
export const markCanvasImageNodeReadyAtom = atom(
  null,
  (get, set, params: { id: string; filePath: string; fileName: string }) => {
    set(
      canvasNodesAtom,
      setImageNodeReady(get(canvasNodesAtom), params.id, params.filePath, params.fileName),
    )
  },
)

/**
 * In-memory cache of the hidden chat-session id per canvas doc, keyed by docId.
 *
 * The source of truth is the doc's persisted `chatSessionId` metadata
 * (CanvasDoc). This atom is seeded from the loaded doc on entry (see
 * seedCanvasChatSessionIdAtom) and updated when the selection chat lazily
 * creates a session, so the id survives selection changes within a session
 * without re-reading the doc. Persisting to doc metadata is what makes it
 * survive restarts and lets delete-doc clean up the bound session.
 */
export const canvasChatSessionIdsAtom = atom<Record<string, string>>({})

/**
 * Seed the in-memory chat-session cache from a doc's persisted metadata. No-op
 * when the doc has no bound session or the cache already matches, so hydrating
 * a doc never churns the atom.
 */
export const seedCanvasChatSessionIdAtom = atom(
  null,
  (get, set, { docId, sessionId }: { docId: string; sessionId: string | undefined }) => {
    if (!sessionId) return
    const current = get(canvasChatSessionIdsAtom)
    if (current[docId] === sessionId) return
    set(canvasChatSessionIdsAtom, { ...current, [docId]: sessionId })
  },
)
