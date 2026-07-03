/**
 * CanvasToolbar — floating action bar at the top of the canvas area.
 *
 * Actions: doc picker overlay, add image node (native file picker via
 * electronAPI), add text node, fit view. New nodes land at the visible
 * viewport center with a small cascade offset so successive adds do not
 * stack exactly on top of each other.
 */

import { useState, type RefObject } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useReactFlow, type XYPosition } from '@xyflow/react'
import { Files, ImagePlus, Maximize, Sparkles, Type } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import {
  addCanvasNodeAtom,
  canvasEdgesAtom,
  canvasNodeCountAtom,
  canvasNodesAtom,
  createImageNode,
  createTextNode,
  selectedCanvasNodeIdsAtom,
} from '@/atoms/canvas'
import { collectReferenceNodeIds } from '@/lib/canvas-generation'
import { useCanvasGeneration } from './canvas-generation-context'

/** Matches the previewable set of the thumbnail:// protocol (images only) */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'heif', 'svg',
])

function isImagePath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.has(ext)
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-foreground/70 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function CanvasToolbar({
  wrapperRef,
  onOpenDocPicker,
}: {
  wrapperRef: RefObject<HTMLDivElement | null>
  onOpenDocPicker: () => void
}) {
  const { t } = useTranslation()
  const { screenToFlowPosition, fitView } = useReactFlow()
  const nodeCount = useAtomValue(canvasNodeCountAtom)
  const addNode = useSetAtom(addCanvasNodeAtom)
  const { generate } = useCanvasGeneration()
  const nodes = useAtomValue(canvasNodesAtom)
  const edges = useAtomValue(canvasEdgesAtom)
  const selectedIds = useAtomValue(selectedCanvasNodeIdsAtom)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [prompt, setPrompt] = useState('')

  const referenceCount = collectReferenceNodeIds(nodes, edges, selectedIds).length

  const centerFlowPosition = (cascadeIndex: number): XYPosition => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    const center = screenToFlowPosition({
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    })
    const step = (cascadeIndex % 8) * 24
    return { x: center.x + step, y: center.y + step }
  }

  const handleAddImage = async () => {
    const paths = await window.electronAPI.openFileDialog()
    const imagePaths = paths.filter(isImagePath)
    imagePaths.forEach((filePath, i) => {
      addNode(createImageNode(filePath, centerFlowPosition(nodeCount + i)))
    })
  }

  const handleAddText = () => {
    addNode(createTextNode(centerFlowPosition(nodeCount)))
  }

  const handleSubmitGenerate = () => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    generate(trimmed, centerFlowPosition(nodeCount))
    setPrompt('')
    setGenerateOpen(false)
  }

  return (
    <div className="relative flex items-center gap-0.5 rounded-lg bg-background p-1 shadow-minimal">
      <ToolbarButton label={t('canvas.docPicker.open')} onClick={onOpenDocPicker}>
        <Files className="h-4 w-4" strokeWidth={1.5} />
      </ToolbarButton>
      <div className="mx-0.5 h-4 w-px bg-foreground/10" />
      <ToolbarButton label={t('canvas.addImage')} onClick={() => void handleAddImage()}>
        <ImagePlus className="h-4 w-4" strokeWidth={1.5} />
      </ToolbarButton>
      <ToolbarButton label={t('canvas.addText')} onClick={handleAddText}>
        <Type className="h-4 w-4" strokeWidth={1.5} />
      </ToolbarButton>
      <ToolbarButton label={t('canvas.generate.button')} onClick={() => setGenerateOpen((v) => !v)}>
        <Sparkles className="h-4 w-4" strokeWidth={1.5} />
      </ToolbarButton>
      <ToolbarButton label={t('canvas.fitView')} onClick={() => void fitView({ duration: 300 })}>
        <Maximize className="h-4 w-4" strokeWidth={1.5} />
      </ToolbarButton>

      {generateOpen && (
        <div className="absolute left-1/2 top-full z-10 mt-2 w-72 -translate-x-1/2 rounded-lg bg-background p-2 shadow-minimal">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t('canvas.generate.title')}
          </div>
          <textarea
            autoFocus
            value={prompt}
            rows={3}
            placeholder={t('canvas.generate.placeholder')}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSubmitGenerate()
              }
              if (e.key === 'Escape') {
                e.stopPropagation()
                setGenerateOpen(false)
              }
            }}
            className="block w-full resize-none rounded-[6px] bg-foreground/5 p-2 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />
          {referenceCount > 0 && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t('canvas.generate.referenceLabel', { count: referenceCount })}
            </p>
          )}
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              disabled={!prompt.trim()}
              onClick={handleSubmitGenerate}
              className="rounded-[6px] bg-accent px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {t('canvas.generate.submit')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
