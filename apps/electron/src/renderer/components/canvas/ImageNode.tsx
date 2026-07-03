/**
 * ImageNode — canvas node rendering a local image file.
 *
 * Loads the image through the thumbnail:// protocol (same mechanism as the
 * session files sidebar), which serves resized previews for absolute file
 * paths. Double-click opens the full-size ImagePreviewOverlay (rendered by
 * CanvasPage). Left handle = target, right handle = source (image-to-image
 * edges).
 */

import { memo, useState } from 'react'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ImageOff, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { canvasImagePreviewAtom, type CanvasImageNode } from '@/atoms/canvas'
import { useCanvasGeneration } from './canvas-generation-context'

function getThumbnailUrl(filePath: string): string {
  return `thumbnail://thumb/${encodeURIComponent(filePath)}`
}

export const ImageNode = memo(function ImageNode({ id, data, selected }: NodeProps<CanvasImageNode>) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const openPreview = useSetAtom(canvasImagePreviewAtom)
  const { retry } = useCanvasGeneration()

  const isPending = data.status === 'pending'
  const isError = data.status === 'error'
  const canPreview = !isPending && !isError && !!data.filePath

  return (
    <div
      onDoubleClick={canPreview ? () => openPreview({ filePath: data.filePath, fileName: data.fileName }) : undefined}
      className={cn(
        'w-48 overflow-hidden rounded-lg bg-background shadow-minimal transition-shadow',
        selected && 'ring-2 ring-accent',
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex h-36 w-full items-center justify-center bg-foreground/5">
        {isPending ? (
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.5} />
            <span className="text-[10px]">{t('canvas.generate.pending')}</span>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-1.5 px-2 text-center">
            <span className="text-[10px] font-medium text-destructive">{t('canvas.generate.error')}</span>
            {data.error ? (
              <span className="line-clamp-2 text-[9px] text-muted-foreground">{data.error}</span>
            ) : null}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                retry(id)
              }}
              className="nodrag mt-0.5 flex items-center gap-1 rounded-[5px] bg-foreground/5 px-2 py-0.5 text-[10px] text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" strokeWidth={1.5} />
              {t('canvas.generate.retry')}
            </button>
          </div>
        ) : failed ? (
          <ImageOff className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        ) : (
          <img
            src={getThumbnailUrl(data.filePath)}
            alt={data.fileName}
            draggable={false}
            onError={() => setFailed(true)}
            className="h-full w-full select-none object-contain"
          />
        )}
      </div>
      <div className="truncate px-2 py-1 text-[10px] text-muted-foreground">
        {data.fileName || (isPending || isError ? t('canvas.generate.title') : '')}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
})
