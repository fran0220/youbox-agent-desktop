/**
 * CanvasPage
 *
 * Full-bleed React Flow canvas for canvas mode. Nodes/edges/viewport live in
 * Jotai atoms (atoms/canvas.ts) — React Flow runs fully controlled and writes
 * every change back through the apply* atoms.
 *
 * Persistence (M2): the page hydrates the atoms from canvas:get for the
 * routed doc id, autosaves changes through canvas:update (debounced, flushed
 * on unmount/doc-switch/window-blur) and reconciles external canvas:changed
 * events. Entering canvas mode without a doc id opens the most recently
 * updated doc, or shows a create-first empty state when none exist.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { XYPosition } from '@xyflow/react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel as FlowPanel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '@/components/canvas/canvas-flow.css'
import { ImagePreviewOverlay } from '@craft-agent/ui'
import { useTheme } from '@/hooks/useTheme'
import { Button } from '@/components/ui/button'
import { ImageNode } from '@/components/canvas/ImageNode'
import { TextNode } from '@/components/canvas/TextNode'
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar'
import { CanvasChatPanel } from '@/components/canvas/CanvasChatPanel'
import { CanvasGenerationProvider } from '@/components/canvas/canvas-generation-context'
import { DocPickerOverlay } from '@/components/canvas/DocPickerOverlay'
import { navigate, routes } from '@/lib/navigate'
import {
  CANVAS_AUTOSAVE_DELAY_MS,
  CanvasDocSaver,
  CanvasEchoGuard,
  mostRecentCanvasDoc,
  reconcileCanvasRemoteChange,
} from '@/lib/canvas-persistence'
import {
  addCanvasNodeAtom,
  applyCanvasEdgeChangesAtom,
  applyCanvasNodeChangesAtom,
  canvasDocsAtom,
  canvasDocStateAtom,
  canvasEdgesAtom,
  canvasImagePreviewAtom,
  canvasNodesAtom,
  canvasViewportAtom,
  connectCanvasEdgeAtom,
  createImageNode,
  deserializeCanvasDocState,
  hydrateCanvasDocAtom,
  mergeRemoteCanvasState,
  seedCanvasChatSessionIdAtom,
  selectedCanvasNodeIdsAtom,
  serializeCanvasDocState,
} from '@/atoms/canvas'
import {
  dataTransferHasCanvasImage,
  imageNodeFromImportedAsset,
  importRequestFromDrop,
  parseCanvasImageDrop,
  type DroppedImageRef,
} from '@/lib/canvas-dnd'
import type { CanvasDoc } from '@craft-agent/shared/protocol'

const DELETE_KEY_CODES = ['Backspace', 'Delete']

/**
 * Dev-only escape hatch: the native image file picker cannot be driven from
 * automated CDP sessions, so dev builds expose a window hook that adds an
 * image node for an absolute path directly. Stripped from production builds.
 */
function useDevAddImageHook(addNode: (node: ReturnType<typeof createImageNode>) => void) {
  const { screenToFlowPosition } = useReactFlow()
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__canvasDevAddImage = (filePath: string) => {
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })
      addNode(createImageNode(filePath, center))
    }
    return () => {
      delete w.__canvasDevAddImage
    }
  }, [addNode, screenToFlowPosition])
}

/**
 * Doc lifecycle for the current route: hydrate atoms from canvas:get,
 * debounce-autosave atom changes back through canvas:update, and reconcile
 * external canvas:changed events (version-guarded so our own update echoes
 * never stomp in-flight local edits).
 */
function useCanvasDocPersistence(workspaceId: string, docId: string) {
  const store = useStore()
  const hydrate = useSetAtom(hydrateCanvasDocAtom)
  const seedChatSession = useSetAtom(seedCanvasChatSessionIdAtom)
  const { setViewport } = useReactFlow()

  useEffect(() => {
    if (!workspaceId || !docId) return
    let disposed = false
    let hydrated = false
    const guard = new CanvasEchoGuard()

    const saver = new CanvasDocSaver({
      delayMs: CANVAS_AUTOSAVE_DELAY_MS,
      serialize: () => serializeCanvasDocState(store.get(canvasDocStateAtom)),
      save: async (state) => {
        const doc = await window.electronAPI.canvasUpdate(workspaceId, docId, { state })
        return doc.version
      },
      onSaved: (version) => guard.noteLocalVersion(version),
      onError: (err) => console.error('[Canvas] Failed to save canvas doc:', err),
    })

    // 'load' hydrates a freshly opened doc (adopt its persisted viewport).
    // 'reconcile' applies a live remote change onto the open doc: structural
    // nodes/edges come from remote, but the local viewport and selection (and
    // any in-flight drag) are preserved so the update never yanks the view.
    const applyDoc = (doc: CanvasDoc, mode: 'load' | 'reconcile') => {
      hydrated = false
      guard.reset(doc.version)
      const remote = deserializeCanvasDocState(doc)
      const next =
        mode === 'reconcile'
          ? mergeRemoteCanvasState(store.get(canvasDocStateAtom), remote)
          : remote
      saver.baseline(serializeCanvasDocState(next))
      hydrate(next)
      // Seed the selection-chat cache from the doc's persisted binding (source
      // of truth) so the chat reuses the same hidden session across restarts.
      seedChatSession({ docId, sessionId: doc.chatSessionId })
      if (mode === 'load') void setViewport(doc.viewport)
      hydrated = true
    }

    const unsubscribers = [canvasNodesAtom, canvasEdgesAtom, canvasViewportAtom].map((anAtom) =>
      store.sub(anAtom, () => {
        if (hydrated) saver.schedule()
      }),
    )

    const reconcileRemoteChange = () =>
      // Dirty local edits win (last-write-wins): the saver pushes them first,
      // then the version guard decides whether the remote doc is newer.
      reconcileCanvasRemoteChange({
        saver,
        guard,
        fetchDoc: () => window.electronAPI.canvasGet(workspaceId, docId),
        applyDoc: (doc) => applyDoc(doc, 'reconcile'),
        isDisposed: () => disposed,
      })

    const cleanupChanged = window.electronAPI.onCanvasChanged((event) => {
      if (event.workspaceId !== workspaceId || event.docId !== docId) return
      if (event.kind === 'deleted') {
        saver.dispose()
        hydrated = false
        const remaining = (store.get(canvasDocsAtom) ?? []).filter((d) => d.id !== docId)
        const next = mostRecentCanvasDoc(remaining)
        navigate(routes.view.studio('canvas', next?.id))
        return
      }
      void reconcileRemoteChange().catch((err) => {
        console.error('[Canvas] Failed to reconcile canvas doc:', err)
      })
    })

    window.electronAPI
      .canvasGet(workspaceId, docId)
      .then((doc) => {
        if (disposed) return
        if (!doc) {
          // Stale/deleted doc id in the route — fall back to auto-selection
          navigate(routes.view.studio('canvas'))
          return
        }
        applyDoc(doc, 'load')
      })
      .catch((err) => {
        console.error('[Canvas] Failed to load canvas doc:', err)
      })

    const handleWindowBlur = () => saver.flush()
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('blur', handleWindowBlur)
      cleanupChanged()
      unsubscribers.forEach((unsub) => unsub())
      // Flush pending edits of the outgoing doc before switching/unmounting;
      // dispose so a failed final save cannot retry against re-hydrated atoms
      saver.flush()
      saver.dispose()
      disposed = true
    }
  }, [workspaceId, docId, store, hydrate, seedChatSession, setViewport])
}

function CanvasFlow({
  workspaceId,
  docId,
  onOpenDocPicker,
}: {
  workspaceId: string
  docId: string
  onOpenDocPicker: () => void
}) {
  const { t } = useTranslation()
  const { isDark } = useTheme()
  const wrapperRef = useRef<HTMLDivElement>(null)

  const nodes = useAtomValue(canvasNodesAtom)
  const edges = useAtomValue(canvasEdgesAtom)
  const selectedIds = useAtomValue(selectedCanvasNodeIdsAtom)
  const onNodesChange = useSetAtom(applyCanvasNodeChangesAtom)
  const onEdgesChange = useSetAtom(applyCanvasEdgeChangesAtom)
  const onConnect = useSetAtom(connectCanvasEdgeAtom)
  const onViewportChange = useSetAtom(canvasViewportAtom)
  const addNode = useSetAtom(addCanvasNodeAtom)
  const [imagePreview, setImagePreview] = useAtom(canvasImagePreviewAtom)
  const [chatDismissed, setChatDismissed] = useState(false)
  const { screenToFlowPosition } = useReactFlow()
  useDevAddImageHook(addNode)
  useCanvasDocPersistence(workspaceId, docId)

  // Chat-image drag-and-drop: dropping an image dragged from a chat message
  // copies it into the doc's asset dir (canvas:importAsset) and creates an
  // image node at the pointer pointing at the portable copy — not the chat
  // attachment's original absolute path.
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasCanvasImage(event.dataTransfer.types)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const importDroppedImage = useCallback(
    async (ref: DroppedImageRef, position: XYPosition) => {
      try {
        const result = await window.electronAPI.canvasImportAsset(
          importRequestFromDrop(ref, { workspaceId, docId }),
        )
        if (!result.ok) {
          toast.error(t('canvas.dropImage.error'))
          return
        }
        addNode(imageNodeFromImportedAsset(result.assetPath, position, ref.fileName))
      } catch (err) {
        console.error('[Canvas] Failed to import dropped image:', err)
        toast.error(t('canvas.dropImage.error'))
      }
    },
    [workspaceId, docId, addNode, t],
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const ref = parseCanvasImageDrop(event.dataTransfer)
      if (!ref) return
      event.preventDefault()
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      void importDroppedImage(ref, position)
    },
    [screenToFlowPosition, importDroppedImage],
  )

  const nodeTypes = useMemo<NodeTypes>(() => ({ image: ImageNode, text: TextNode }), [])
  const chatOpen = selectedIds.length > 0 && !chatDismissed

  // Re-arm the chat panel once the selection clears, so a fresh selection
  // reopens it even after the user dismissed it for a previous selection.
  useEffect(() => {
    if (selectedIds.length === 0 && chatDismissed) setChatDismissed(false)
  }, [selectedIds.length, chatDismissed])

  return (
    <CanvasGenerationProvider workspaceId={workspaceId} docId={docId}>
    <div
      ref={wrapperRef}
      className="canvas-flow relative h-full w-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onViewportChange={onViewportChange}
        colorMode={isDark ? 'dark' : 'light'}
        deleteKeyCode={DELETE_KEY_CODES}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={4}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <MiniMap pannable zoomable />
        <Controls />
        <FlowPanel position="top-center">
          <CanvasToolbar wrapperRef={wrapperRef} onOpenDocPicker={onOpenDocPicker} />
        </FlowPanel>
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex select-none flex-col items-center justify-center gap-1 text-center">
          <h2 className="text-sm font-medium text-foreground">{t('canvas.emptyTitle')}</h2>
          <p className="max-w-xs text-xs text-muted-foreground">{t('canvas.emptyDescription')}</p>
        </div>
      )}
      {imagePreview && (
        <ImagePreviewOverlay
          isOpen
          onClose={() => setImagePreview(null)}
          filePath={imagePreview.filePath}
          title={imagePreview.fileName}
          loadDataUrl={(path) => window.electronAPI.readFileDataUrl(path)}
          theme={isDark ? 'dark' : 'light'}
        />
      )}
      {chatOpen && (
        <CanvasChatPanel
          workspaceId={workspaceId}
          docId={docId}
          onClose={() => setChatDismissed(true)}
        />
      )}
    </div>
    </CanvasGenerationProvider>
  )
}

/** Create-first empty state shown when the workspace has no canvas docs yet */
function CanvasEmptyState({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    setCreating(true)
    try {
      const doc = await window.electronAPI.canvasCreate(workspaceId, {
        name: t('canvas.defaultDocName'),
      })
      navigate(routes.view.studio('canvas', doc.id))
    } catch (err) {
      console.error('[Canvas] Failed to create canvas doc:', err)
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full w-full select-none flex-col items-center justify-center gap-3 text-center">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{t('canvas.createFirst.title')}</h2>
        <p className="max-w-xs text-xs text-muted-foreground">{t('canvas.createFirst.description')}</p>
      </div>
      <Button size="sm" disabled={creating} onClick={() => void handleCreate()}>
        {t('canvas.createFirst.button')}
      </Button>
    </div>
  )
}

export interface CanvasPageProps {
  workspaceId: string
  /** Routed canvas doc id (canvas/doc/{id}); null on the bare canvas route */
  docId: string | null
}

export default function CanvasPage({ workspaceId, docId }: CanvasPageProps) {
  const docs = useAtomValue(canvasDocsAtom)
  // Lives here (not in CanvasFlow, which remounts per doc) so the picker
  // stays open across doc switches — e.g. create + inline rename
  const [pickerOpen, setPickerOpen] = useState(false)

  // Bare canvas route: open the most recently updated doc once the list is
  // known. Normally navigate() auto-selects this synchronously; this effect
  // covers the case where the doc list loads after the route settled.
  useEffect(() => {
    if (docId || !workspaceId || !docs) return
    const mostRecent = mostRecentCanvasDoc(docs)
    if (mostRecent) navigate(routes.view.studio('canvas', mostRecent.id))
  }, [docId, workspaceId, docs])

  if (!docId) {
    // Loading the doc list, or redirecting to the most recent doc
    if (!docs || docs.length > 0) return null
    return <CanvasEmptyState workspaceId={workspaceId} />
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlowProvider>
        <CanvasFlow
          key={docId}
          workspaceId={workspaceId}
          docId={docId}
          onOpenDocPicker={() => setPickerOpen(true)}
        />
      </ReactFlowProvider>
      {pickerOpen && (
        <DocPickerOverlay
          workspaceId={workspaceId}
          currentDocId={docId}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
