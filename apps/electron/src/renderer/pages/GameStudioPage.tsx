import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent, type SetStateAction } from 'react'
import { useAtomValue, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNowStrict } from 'date-fns'
import type { Locale } from 'date-fns'
import { Check, ChevronDown, MessageSquare, Pencil, Play, Plus, Square, Trash2, X } from 'lucide-react'
import { getDateLocale } from '@craft-agent/shared/i18n'
import { Button } from '@/components/ui/button'
import { gamestudioProjectsAtom, mostRecentGameProject, sortGameProjectsByUpdatedAtDesc } from '@/atoms/gamestudio'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { GameProjectMeta } from '@craft-agent/shared/protocol'

const SPLIT_STORAGE_KEY = 'gamestudio.previewSplitRatio'
const DEFAULT_PREVIEW_RATIO = 0.68
const MIN_PREVIEW_RATIO = 0.45
const MAX_PREVIEW_RATIO = 0.82

function clampPreviewRatio(value: number): number {
  return Math.min(MAX_PREVIEW_RATIO, Math.max(MIN_PREVIEW_RATIO, value))
}

function readPreviewRatio(): number {
  if (typeof window === 'undefined') return DEFAULT_PREVIEW_RATIO
  const raw = window.localStorage.getItem(SPLIT_STORAGE_KEY)
  if (!raw) return DEFAULT_PREVIEW_RATIO
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? clampPreviewRatio(parsed) : DEFAULT_PREVIEW_RATIO
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
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation()
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

function ProjectPickerOverlay({
  workspaceId,
  projects,
  currentProjectId,
  onClose,
}: {
  workspaceId: string
  projects: readonly GameProjectMeta[]
  currentProjectId: string
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const dateLocale = getDateLocale(i18n.resolvedLanguage ?? 'en') as Locale | undefined
  const sortedProjects = useMemo(
    () => sortGameProjectsByUpdatedAtDesc(projects),
    [projects],
  )

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
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

  const startRename = (project: GameProjectMeta) => {
    setConfirmDeleteId(null)
    setRenameDraft(project.name)
    setRenamingId(project.id)
  }

  const commitRename = async (project: GameProjectMeta) => {
    setRenamingId(null)
    const name = renameDraft.trim()
    if (!name || name === project.name) return
    try {
      await window.electronAPI.gameProjectUpdate(workspaceId, project.id, { name })
    } catch (err) {
      console.error('[GameStudio] Failed to rename project:', err)
    }
  }

  const handleCreate = async () => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      const project = await window.electronAPI.gameProjectCreate(workspaceId, {
        name: t('gamestudio.defaultProjectName'),
      })
      navigate(routes.view.gamestudio(project.id))
      setConfirmDeleteId(null)
      setRenameDraft(project.name)
      setRenamingId(project.id)
    } catch (err) {
      console.error('[GameStudio] Failed to create project:', err)
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  const handleDelete = async (projectId: string) => {
    const remaining = sortedProjects.filter((project) => project.id !== projectId)
    setConfirmDeleteId(null)
    try {
      await window.electronAPI.gameProjectDelete(workspaceId, projectId)
    } catch (err) {
      console.error('[GameStudio] Failed to delete project:', err)
      return
    }
    if (projectId === currentProjectId) {
      const next = mostRecentGameProject(remaining)
      navigate(routes.view.gamestudio(next?.id))
    }
  }

  const handleSwitch = (projectId: string) => {
    if (projectId !== currentProjectId) navigate(routes.view.gamestudio(projectId))
    onClose()
  }

  return (
    <div
      className="absolute inset-0 z-20 flex items-start justify-center bg-black/20 pt-14"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={t('gamestudio.projectPicker.title')}
        className="popover-styled flex max-h-[70%] w-80 flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-foreground/5 px-3 py-2">
          <h3 className="text-xs font-medium text-foreground">{t('gamestudio.projectPicker.title')}</h3>
          <button
            type="button"
            aria-label={t('gamestudio.projectPicker.new')}
            onClick={() => void handleCreate()}
            disabled={creating}
            className="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-xs text-foreground/70 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t('gamestudio.projectPicker.new')}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {sortedProjects.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t('gamestudio.projectPicker.empty')}
            </div>
          )}
          {sortedProjects.map((project) => (
            <div
              key={project.id}
              onClick={() => handleSwitch(project.id)}
              className={cn(
                'group flex cursor-default items-center gap-2 rounded-[6px] px-2 py-1.5',
                project.id === currentProjectId ? 'bg-foreground/5' : 'hover:bg-foreground/5',
              )}
            >
              {renamingId === project.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <input
                    autoFocus
                    value={renameDraft}
                    placeholder={t('gamestudio.projectPicker.renamePlaceholder')}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onFocus={(event) => event.target.select()}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => void commitRename(project)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void commitRename(project)
                      }
                    }}
                    className="min-w-0 flex-1 rounded-[4px] bg-foreground/5 px-1.5 py-0.5 text-xs text-foreground outline-none"
                  />
                  <RowIconButton label={t('common.save')} onClick={() => void commitRename(project)}>
                    <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </RowIconButton>
                </div>
              ) : null}
              {renamingId !== project.id && (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-foreground">{project.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {formatDistanceToNowStrict(new Date(project.updatedAt), {
                      addSuffix: true,
                      locale: dateLocale,
                    })}
                  </div>
                </div>
              )}
              {confirmDeleteId === project.id ? (
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                  <span className="text-[10px] text-muted-foreground">
                    {t('gamestudio.projectPicker.deleteConfirm')}
                  </span>
                  <RowIconButton label={t('common.delete')} destructive onClick={() => void handleDelete(project.id)}>
                    <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </RowIconButton>
                  <RowIconButton label={t('common.cancel')} onClick={() => setConfirmDeleteId(null)}>
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </RowIconButton>
                </div>
              ) : (
                renamingId !== project.id && (
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                    <RowIconButton label={t('common.rename')} onClick={() => startRename(project)}>
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </RowIconButton>
                    <RowIconButton
                      label={t('common.delete')}
                      destructive
                      onClick={() => {
                        setRenamingId(null)
                        setConfirmDeleteId(project.id)
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

export interface GameStudioPageProps {
  workspaceId: string
  projectId: string | null
}

function GameStudioEmptyState({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false)

  const handleCreate = async () => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      const project = await window.electronAPI.gameProjectCreate(workspaceId, {
        name: t('gamestudio.defaultProjectName'),
      })
      navigate(routes.view.gamestudio(project.id))
    } catch (err) {
      console.error('[GameStudio] Failed to create project:', err)
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full w-full select-none flex-col items-center justify-center gap-3 text-center">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{t('gamestudio.createFirst.title')}</h2>
        <p className="max-w-sm text-xs text-muted-foreground">{t('gamestudio.createFirst.description')}</p>
      </div>
      <Button size="sm" disabled={creating} onClick={() => void handleCreate()}>
        {t('gamestudio.createFirst.button')}
      </Button>
    </div>
  )
}

function GameStudioProjectShell({
  workspaceId,
  projectId,
  projects,
  pickerOpen,
  setPickerOpen,
}: {
  workspaceId: string
  projectId: string
  projects: readonly GameProjectMeta[]
  pickerOpen: boolean
  setPickerOpen: Dispatch<SetStateAction<boolean>>
}) {
  const { t } = useTranslation()
  const [previewRatio, setPreviewRatio] = useState(readPreviewRatio)
  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  )

  const startDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.parentElement
    if (!container) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = container.getBoundingClientRect()
    const update = (clientX: number) => {
      const ratio = clampPreviewRatio((clientX - rect.left) / rect.width)
      setPreviewRatio(ratio)
      window.localStorage.setItem(SPLIT_STORAGE_KEY, String(ratio))
    }
    update(event.clientX)
    const handleMove = (moveEvent: globalThis.PointerEvent) => update(moveEvent.clientX)
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp, { once: true })
  }, [])

  return (
    <div key={projectId} className="relative flex h-full w-full overflow-hidden bg-background">
      <div
        className="flex min-w-0 flex-col border-r border-border/70"
        style={{ width: `${previewRatio * 100}%` }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card/60 px-3">
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 gap-2"
            onClick={() => setPickerOpen(true)}
            title={t('gamestudio.toolbar.switchProject')}
          >
            <span className="truncate font-medium">{currentProject?.name ?? t('appMode.gamestudio')}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </Button>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled title={t('gamestudio.toolbar.run')}>
              <Play className="mr-1.5 h-3.5 w-3.5" />
              {t('gamestudio.toolbar.run')}
            </Button>
            <Button variant="ghost" size="sm" disabled title={t('gamestudio.toolbar.stop')}>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              {t('gamestudio.toolbar.stop')}
            </Button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted/20">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              {t('gamestudio.preview.statusIdle')}
            </div>
            <p className="max-w-xs text-sm text-muted-foreground">{t('gamestudio.preview.runPrompt')}</p>
          </div>
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        className="z-10 w-1.5 cursor-col-resize bg-border/50 transition-colors hover:bg-primary/60"
        onPointerDown={startDrag}
      />

      <aside className="flex min-w-64 flex-1 flex-col bg-card/40">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 text-sm font-medium text-foreground">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          {t('gamestudio.chat.placeholderTitle')}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {t('gamestudio.chat.placeholderDescription')}
        </div>
      </aside>

      {pickerOpen && (
        <ProjectPickerOverlay
          workspaceId={workspaceId}
          projects={projects}
          currentProjectId={projectId}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

export default function GameStudioPage({ workspaceId, projectId }: GameStudioPageProps) {
  const projects = useAtomValue(gamestudioProjectsAtom)
  const store = useStore()
  const [pickerOpen, setPickerOpen] = useState(false)

  // Bare gamestudio route: open the most recently updated project once the
  // project list is known. NavigationContext usually does this synchronously;
  // this covers the async list-loading case.
  useEffect(() => {
    if (projectId || !workspaceId || !projects) return
    const mostRecent = mostRecentGameProject(projects)
    if (mostRecent) navigate(routes.view.gamestudio(mostRecent.id))
  }, [projectId, workspaceId, projects])

  // Stale/deleted project id fallback, mirroring CanvasPage. The page never
  // renders a crash state for a missing route target; it falls back to the bare
  // route so the normal most-recent/empty-state logic takes over.
  useEffect(() => {
    if (!workspaceId || !projectId) return
    let disposed = false
    const cleanup = window.electronAPI.onGameProjectChanged((event) => {
      if (event.workspaceId !== workspaceId || event.projectId !== projectId) return
      if (event.kind === 'deleted') {
        const remaining = (store.get(gamestudioProjectsAtom) ?? []).filter((p) => p.id !== projectId)
        const next = mostRecentGameProject(remaining)
        navigate(routes.view.gamestudio(next?.id))
      }
    })
    window.electronAPI.gameProjectGet(workspaceId, projectId).then((project) => {
      if (!disposed && !project) navigate(routes.view.gamestudio())
    }).catch((err) => {
      console.error('[GameStudio] Failed to load project:', err)
    })
    return () => {
      disposed = true
      cleanup()
    }
  }, [workspaceId, projectId, store])

  if (!projectId) {
    if (!projects || projects.length > 0) return null
    return <GameStudioEmptyState workspaceId={workspaceId} />
  }

  return (
    <GameStudioProjectShell
      key={projectId}
      workspaceId={workspaceId}
      projectId={projectId}
      projects={projects ?? []}
      pickerOpen={pickerOpen}
      setPickerOpen={setPickerOpen}
    />
  )
}
