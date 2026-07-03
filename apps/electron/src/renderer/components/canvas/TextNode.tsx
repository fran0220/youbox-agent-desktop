/**
 * TextNode — editable text/prompt note on the canvas.
 *
 * Double-click enters edit mode (textarea); blur commits the draft back into
 * the canvas atoms, Escape cancels. The textarea carries React Flow's
 * nodrag/nowheel classes so typing and scrolling never move the node.
 */

import { memo, useState } from 'react'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { setTextNodeTextAtom, type CanvasTextNode } from '@/atoms/canvas'

export const TextNode = memo(function TextNode({ id, data, selected }: NodeProps<CanvasTextNode>) {
  const { t } = useTranslation()
  const setText = useSetAtom(setTextNodeTextAtom)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startEditing = () => {
    setDraft(data.text)
    setEditing(true)
  }

  const commit = () => {
    setText({ id, text: draft })
    setEditing(false)
  }

  return (
    <div
      onDoubleClick={editing ? undefined : startEditing}
      className={cn(
        'w-48 rounded-lg bg-background p-2 shadow-minimal transition-shadow',
        selected && 'ring-2 ring-accent',
      )}
    >
      <Handle type="target" position={Position.Left} />
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          rows={4}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Escape') {
              e.stopPropagation()
              setEditing(false)
            }
          }}
          className="nodrag nowheel block w-full resize-none bg-transparent text-xs leading-relaxed text-foreground outline-none"
        />
      ) : (
        <div
          className={cn(
            'min-h-[3rem] whitespace-pre-wrap break-words text-xs leading-relaxed',
            data.text ? 'text-foreground' : 'italic text-muted-foreground',
          )}
        >
          {data.text || t('canvas.textPlaceholder')}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
})
