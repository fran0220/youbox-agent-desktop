/**
 * CanvasGenerationProvider — orchestrates prompt-to-image generation for the
 * current canvas doc and exposes {generate, retry} to descendants (toolbar
 * popover + ImageNode retry button) via context.
 *
 * generate(prompt, position):
 *   1. resolve image-to-image references from the current selection/edges,
 *   2. add a pending placeholder node at `position`,
 *   3. call canvasGenerateImage with that node id.
 * On success the placeholder is optimistically committed to the returned asset
 * (the server's canvas:changed broadcast reconciles the same node id, so the
 * spinner always clears). On a typed error the node flips to a retryable error.
 */

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import { useSetAtom, useStore } from 'jotai'
import { type XYPosition } from '@xyflow/react'
import {
  addCanvasNodeAtom,
  canvasEdgesAtom,
  canvasNodesAtom,
  markCanvasImageNodeErrorAtom,
  markCanvasImageNodePendingAtom,
  markCanvasImageNodeReadyAtom,
  selectedCanvasNodeIdsAtom,
} from '@/atoms/canvas'
import {
  buildGenerationPrompt,
  collectReferenceNodeIds,
  collectSelectedTextContext,
  createPendingImageNode,
  isImageNodeGenerating,
} from '@/lib/canvas-generation'

interface CanvasGenerationActions {
  /** Generate an image from `prompt`, placing the result node at `position` */
  generate: (prompt: string, position: XYPosition) => void
  /** Re-run generation for an existing (errored) placeholder node */
  retry: (nodeId: string) => void
}

const CanvasGenerationContext = createContext<CanvasGenerationActions | null>(null)

export function useCanvasGeneration(): CanvasGenerationActions {
  const ctx = useContext(CanvasGenerationContext)
  if (!ctx) throw new Error('useCanvasGeneration must be used within CanvasGenerationProvider')
  return ctx
}

export function CanvasGenerationProvider({
  workspaceId,
  docId,
  children,
}: {
  workspaceId: string
  docId: string
  children: ReactNode
}) {
  const store = useStore()
  const addNode = useSetAtom(addCanvasNodeAtom)
  const markPending = useSetAtom(markCanvasImageNodePendingAtom)
  const markError = useSetAtom(markCanvasImageNodeErrorAtom)
  const markReady = useSetAtom(markCanvasImageNodeReadyAtom)

  // Ids with a generation dispatched but not yet settled. Prevents a second
  // concurrent generation on the same node (double-click retry / re-generate)
  // that would fire a duplicate canvasGenerateImage call and orphan an asset —
  // robust even against a truly same-tick double invocation, before any atom
  // state has flushed.
  const inFlightRef = useRef<Set<string>>(new Set())

  const runGeneration = useCallback(
    async (nodeId: string, prompt: string, referenceNodeIds: string[]) => {
      if (inFlightRef.current.has(nodeId)) return
      inFlightRef.current.add(nodeId)
      markPending({ id: nodeId, prompt, referenceNodeIds })
      try {
        const result = await window.electronAPI.canvasGenerateImage({
          workspaceId,
          docId,
          prompt,
          nodeId,
          referenceNodeIds: referenceNodeIds.length > 0 ? referenceNodeIds : undefined,
        })
        if (result.ok) {
          markReady({ id: nodeId, filePath: result.assetPath, fileName: result.imageFileName })
        } else {
          markError({ id: nodeId, message: result.message })
        }
      } catch (err) {
        markError({ id: nodeId, message: err instanceof Error ? err.message : String(err) })
      } finally {
        inFlightRef.current.delete(nodeId)
      }
    },
    [workspaceId, docId, markPending, markReady, markError],
  )

  const generate = useCallback(
    (prompt: string, position: XYPosition) => {
      const nodes = store.get(canvasNodesAtom)
      const edges = store.get(canvasEdgesAtom)
      const selectedIds = store.get(selectedCanvasNodeIdsAtom)
      const referenceNodeIds = collectReferenceNodeIds(nodes, edges, selectedIds)
      const textContext = collectSelectedTextContext(nodes, selectedIds)
      const fullPrompt = buildGenerationPrompt(prompt, textContext)
      const node = createPendingImageNode(fullPrompt, position, referenceNodeIds)
      addNode(node)
      void runGeneration(node.id, fullPrompt, referenceNodeIds)
    },
    [store, addNode, runGeneration],
  )

  const retry = useCallback(
    (nodeId: string) => {
      const nodes = store.get(canvasNodesAtom)
      // No-op while a generation for this node is already pending/in flight.
      if (isImageNodeGenerating(nodes, nodeId)) return
      const node = nodes.find((n) => n.id === nodeId)
      const prompt = node?.type === 'image' ? node.data.prompt ?? '' : ''
      const referenceNodeIds = node?.type === 'image' ? node.data.referenceNodeIds ?? [] : []
      void runGeneration(nodeId, prompt, referenceNodeIds)
    },
    [store, runGeneration],
  )

  const value = useMemo<CanvasGenerationActions>(() => ({ generate, retry }), [generate, retry])

  return <CanvasGenerationContext.Provider value={value}>{children}</CanvasGenerationContext.Provider>
}
