/**
 * DocPickerOverlay — in-canvas overlay for managing canvas documents.
 *
 * Opened from the canvas toolbar. Lists the workspace's canvas docs (name +
 * last-updated), supports create / inline rename / delete-with-confirm and
 * switches docs by navigating to canvas/doc/{id}. Closes on Escape or
 * backdrop click. The list itself lives in canvasDocsAtom (kept fresh by
 * AppShell's canvas:changed subscription).
 */

import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNowStrict } from 'date-fns'
import type { Locale } from 'date-fns'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { getDateLocale } from '@craft-agent/shared/i18n'
import type { CanvasDocMeta } from '@craft-agent/shared/protocol'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { mostRecentCanvasDoc } from '@/lib/canvas-persistence'
import { canvasDocsAtom } from '@/atoms/canvas'

interface DocPickerOverlayProps {
  workspaceId: string
  currentDocId: string
  onClose: () => void
}

function RowIconButton({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-foreground/50 transition-colors duration-100 hover:bg-foreground/5',
        destructive ? 'hover:text-destructive' : 'hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export function DocPickerOverlay({ workspaceId, currentDocId, onClose }: DocPickerOverlayProps) {
  const { t, i18n } = useTranslation()
  const docs = useAtomValue(canvasDocsAtom) ?? []
  const dateLocale = getDateLocale(i18n.resolvedLanguage ?? 'en') as Locale | undefined

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (renamingId) {
        setRenamingId(null)
      } else if (confirmDeleteId) {
        setConfirmDeleteId(null)
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [renamingId, confirmDeleteId, onClose])

  const startRename = (doc: CanvasDocMeta) => {
    setConfirmDeleteId(null)
    setRenameDraft(doc.name)
    setRenamingId(doc.id)
  }

  const commitRename = async (doc: CanvasDocMeta) => {
    setRenamingId(null)
    const name = renameDraft.trim()
    if (!name || name === doc.name) return
    try {
      await window.electronAPI.canvasUpdate(workspaceId, doc.id, { name })
    } catch (err) {
      console.error('[Canvas] Failed to rename canvas doc:', err)
    }
  }

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    try {
      const doc = await window.electronAPI.canvasCreate(workspaceId, {
        name: t('canvas.defaultDocName'),
      })
      navigate(routes.view.studio('canvas', doc.id))
      setRenameDraft(doc.name)
      setRenamingId(doc.id)
    } catch (err) {
      console.error('[Canvas] Failed to create canvas doc:', err)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (docId: string) => {
    const remaining = docs.filter((d) => d.id !== docId)
    setConfirmDeleteId(null)
    try {
      await window.electronAPI.canvasDelete(workspaceId, docId)
    } catch (err) {
      console.error('[Canvas] Failed to delete canvas doc:', err)
      return
    }
    if (docId === currentDocId) {
      const next = mostRecentCanvasDoc(remaining)
      navigate(routes.view.studio('canvas', next?.id))
    }
  }

  const handleSwitch = (docId: string) => {
    if (docId !== currentDocId) navigate(routes.view.studio('canvas', docId))
    onClose()
  }

  return (
    <div
      className="absolute inset-0 z-20 flex items-start justify-center bg-black/20 pt-14"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={t('canvas.docPicker.title')}
        className="popover-styled flex max-h-[70%] w-80 flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-foreground/5 px-3 py-2">
          <h3 className="text-xs font-medium text-foreground">{t('canvas.docPicker.title')}</h3>
          <button
            type="button"
            aria-label={t('canvas.docPicker.new')}
            onClick={() => void handleCreate()}
            disabled={creating}
            className="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-xs text-foreground/70 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t('canvas.docPicker.new')}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {docs.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t('canvas.docPicker.empty')}
            </div>
          )}
          {docs.map((doc) => (
            <div
              key={doc.id}
              onClick={() => handleSwitch(doc.id)}
              className={cn(
                'group flex cursor-default items-center gap-2 rounded-[6px] px-2 py-1.5',
                doc.id === currentDocId ? 'bg-foreground/5' : 'hover:bg-foreground/5',
              )}
            >
              {renamingId === doc.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  placeholder={t('canvas.docPicker.renamePlaceholder')}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => void commitRename(doc)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void commitRename(doc)
                    }
                  }}
                  className="min-w-0 flex-1 rounded-[4px] bg-foreground/5 px-1.5 py-0.5 text-xs text-foreground outline-none"
                />
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-foreground">{doc.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {formatDistanceToNowStrict(new Date(doc.updatedAt), {
                      addSuffix: true,
                      locale: dateLocale,
                    })}
                  </div>
                </div>
              )}
              {confirmDeleteId === doc.id ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[10px] text-muted-foreground">
                    {t('canvas.docPicker.deleteConfirm')}
                  </span>
                  <RowIconButton label={t('common.delete')} destructive onClick={() => void handleDelete(doc.id)}>
                    <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </RowIconButton>
                  <RowIconButton label={t('common.cancel')} onClick={() => setConfirmDeleteId(null)}>
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </RowIconButton>
                </div>
              ) : (
                renamingId !== doc.id && (
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                    <RowIconButton label={t('common.rename')} onClick={() => startRename(doc)}>
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </RowIconButton>
                    <RowIconButton
                      label={t('common.delete')}
                      destructive
                      onClick={() => {
                        setRenamingId(null)
                        setConfirmDeleteId(doc.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </RowIconButton>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
