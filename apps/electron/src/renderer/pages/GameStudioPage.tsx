import { useCallback, useEffect, useMemo, useState, type PointerEvent } from 'react'
import { useAtomValue, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { ChevronDown, MessageSquare, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { gamestudioProjectsAtom, mostRecentGameProject } from '@/atoms/gamestudio'
import { navigate, routes } from '@/lib/navigate'
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

function ProjectSwitchOverlay({
  projects,
  currentProjectId,
  onClose,
}: {
  projects: readonly GameProjectMeta[]
  currentProjectId: string
  onClose: () => void
}) {
  const { t } = useTranslation()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-background/60 p-8 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mt-12 flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-modal-small"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">{t('gamestudio.projectSwitcher.title')}</h2>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent ${
                project.id === currentProjectId ? 'bg-accent text-accent-foreground' : 'text-foreground'
              }`}
              onClick={() => {
                navigate(routes.view.gamestudio(project.id))
                onClose()
              }}
            >
              <span className="truncate">{project.name}</span>
              {project.id === currentProjectId ? (
                <span className="shrink-0 text-xs text-muted-foreground">{t('gamestudio.projectSwitcher.current')}</span>
              ) : null}
            </button>
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

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    try {
      const project = await window.electronAPI.gameProjectCreate(workspaceId, {
        name: t('gamestudio.defaultProjectName'),
      })
      navigate(routes.view.gamestudio(project.id))
    } catch (err) {
      console.error('[GameStudio] Failed to create project:', err)
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
  projectId,
  projects,
}: {
  projectId: string
  projects: readonly GameProjectMeta[]
}) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
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
        <ProjectSwitchOverlay
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
      projectId={projectId}
      projects={projects ?? []}
    />
  )
}
