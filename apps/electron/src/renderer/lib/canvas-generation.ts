/**
 * Canvas image-generation logic — pure helpers behind the prompt-to-image and
 * selection-context flows (M3). Kept free of React/Jotai/xyflow runtime so the
 * node-state reducers, reference collection and context serialization are unit
 * testable in isolation.
 *
 * Generation lifecycle lives on the image node's `data`:
 * - `status: 'pending'` — placeholder shown as a spinner while the server
 *   generates. `filePath` is empty until backfilled.
 * - `status: 'error'`  — generation failed; `error` holds the message and the
 *   node exposes a retry affordance (re-runs with `prompt` + `referenceNodeIds`).
 * - no `status`        — a committed image (server backfilled `filePath`).
 *
 * On success the renderer optimistically flips the node to the committed shape
 * with the returned asset path; the server's canvas:changed broadcast then
 * reconciles the same node, so the pending UI can never orphan a spinner.
 */

import type {
  CanvasEdge,
  CanvasImageNode,
  CanvasNode,
} from '@/atoms/canvas'

function newImageNodeId(): string {
  return `image-${crypto.randomUUID()}`
}

/** Create a pending placeholder image node for an in-flight generation. */
export function createPendingImageNode(
  prompt: string,
  position: { x: number; y: number },
  referenceNodeIds: string[] = [],
): CanvasImageNode {
  return {
    id: newImageNodeId(),
    type: 'image',
    position,
    data: {
      filePath: '',
      fileName: '',
      status: 'pending',
      prompt,
      referenceNodeIds,
    },
  }
}

/**
 * True when `id` refers to an image node whose generation is currently in
 * flight (status `pending`). Used to guard against a second concurrent
 * generation on the same node — e.g. a same-tick double-click on retry, which
 * would otherwise fire two canvasGenerateImage calls and orphan an asset.
 */
export function isImageNodeGenerating(nodes: CanvasNode[], id: string): boolean {
  const node = nodes.find((n) => n.id === id)
  return node?.type === 'image' && node.data.status === 'pending'
}

function mapImageNode(
  nodes: CanvasNode[],
  id: string,
  transform: (node: CanvasImageNode) => CanvasImageNode,
): CanvasNode[] {
  return nodes.map((node) =>
    node.id === id && node.type === 'image' ? transform(node as CanvasImageNode) : node,
  )
}

/** Flip a node back to the pending (spinner) state — used on generate + retry. */
export function setImageNodePending(
  nodes: CanvasNode[],
  id: string,
  params: { prompt?: string; referenceNodeIds?: string[] } = {},
): CanvasNode[] {
  return mapImageNode(nodes, id, (node) => ({
    ...node,
    data: {
      ...node.data,
      status: 'pending',
      error: undefined,
      prompt: params.prompt ?? node.data.prompt,
      referenceNodeIds: params.referenceNodeIds ?? node.data.referenceNodeIds,
    },
  }))
}

/** Mark a node's generation as failed with a (secret-redacted) message. */
export function setImageNodeError(
  nodes: CanvasNode[],
  id: string,
  message: string,
): CanvasNode[] {
  return mapImageNode(nodes, id, (node) => ({
    ...node,
    data: { ...node.data, status: 'error', error: message },
  }))
}

/**
 * Flip a node to the committed image shape (drops transient generation fields).
 * Called optimistically on success so the local doc matches what the server
 * persisted, avoiding a stale-pending overwrite before the broadcast lands.
 */
export function setImageNodeReady(
  nodes: CanvasNode[],
  id: string,
  filePath: string,
  fileName: string,
): CanvasNode[] {
  return mapImageNode(nodes, id, (node) => ({
    ...node,
    data: { filePath, fileName },
  }))
}

/**
 * Convert any still-pending image node into an error state. Applied when a doc
 * is (re)hydrated from storage: a persisted `pending` node has no in-flight
 * generation behind it, so it must not render an eternal spinner — it becomes a
 * retryable error instead.
 */
export function normalizeStalePendingNodes(nodes: CanvasNode[]): CanvasNode[] {
  let changed = false
  const next = nodes.map((node) => {
    if (node.type === 'image' && node.data.status === 'pending') {
      changed = true
      return { ...node, data: { ...node.data, status: 'error' as const, error: '' } }
    }
    return node
  })
  return changed ? next : nodes
}

/**
 * Node ids whose image assets should seed image-to-image generation, given the
 * current selection and edge set. References are:
 * - selected image nodes, and
 * - image nodes wired upstream (edge source) into any selected node.
 * Order is stable (selected first, then upstream) and de-duplicated.
 */
export function collectReferenceNodeIds(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  selectedIds: string[],
): string[] {
  const selected = new Set(selectedIds)
  const imageIds = new Set(nodes.filter((n) => n.type === 'image').map((n) => n.id))
  const result: string[] = []
  const push = (id: string) => {
    if (imageIds.has(id) && !result.includes(id)) result.push(id)
  }
  for (const id of selectedIds) push(id)
  for (const edge of edges) {
    if (selected.has(edge.target)) push(edge.source)
  }
  return result
}

/** Text bodies of the selected text nodes (empty notes skipped). */
export function collectSelectedTextContext(
  nodes: CanvasNode[],
  selectedIds: string[],
): string[] {
  const selected = new Set(selectedIds)
  return nodes
    .filter((n): n is Extract<CanvasNode, { type: 'text' }> => n.type === 'text' && selected.has(n.id))
    .map((n) => n.data.text.trim())
    .filter((text) => text.length > 0)
}

/** Fold selected text-note context into the user prompt sent to the server. */
export function buildGenerationPrompt(prompt: string, textContext: string[]): string {
  const base = prompt.trim()
  if (textContext.length === 0) return base
  return [base, ...textContext].filter((part) => part.length > 0).join('\n\n')
}

/**
 * Serialize the selected nodes into a plain-text context block for the
 * selection chat (the hidden session's first message carries it). Text notes
 * contribute their text; image nodes contribute a filename/prompt reference.
 */
export function serializeSelectionContext(selectedNodes: CanvasNode[]): string {
  const lines: string[] = []
  for (const node of selectedNodes) {
    if (node.type === 'text') {
      const text = node.data.text.trim()
      if (text) lines.push(`- Note: ${text}`)
    } else if (node.type === 'image') {
      const name = node.data.fileName || node.data.filePath
      const prompt = node.data.prompt?.trim()
      if (prompt) lines.push(`- Image "${name}" (prompt: ${prompt})`)
      else if (name) lines.push(`- Image: ${name}`)
    }
  }
  return lines.join('\n')
}
