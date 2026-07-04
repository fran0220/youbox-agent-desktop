import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent, type SetStateAction } from 'react'
import { useAtom, useAtomValue, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNowStrict } from 'date-fns'
import type { Locale } from 'date-fns'
import { Bug, Camera, Check, ChevronDown, FolderOpen, Maximize2, MessageSquare, Pencil, Plus, RefreshCw, RotateCcw, Trash2, Wand2, X } from 'lucide-react'
import { getDateLocale } from '@craft-agent/shared/i18n'
import { Button } from '@/components/ui/button'
import { useAppShellContext } from '@/context/AppShellContext'
import ChatPage from './ChatPage'
import {
  createPendingGameProjectRename,
  gamestudioProjectsAtom,
  mostRecentGameProject,
  pendingGameProjectRenameAtom,
  resolveGameProjectRenameCommit,
  sortGameProjectsByUpdatedAtDesc,
} from '@/atoms/gamestudio'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { GamePaneEvent, GameProjectMeta } from '@craft-agent/shared/protocol'

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

  const [pendingRename, setPendingRename] = useAtom(pendingGameProjectRenameAtom)
  const renamingId = pendingRename?.projectId ?? null
  const renameDraft = pendingRename?.draft ?? ''
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (renamingId) {
        setPendingRename(null)
      } else if (confirmDeleteId) {
        setConfirmDeleteId(null)
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [renamingId, confirmDeleteId, onClose, setPendingRename])

  const startRename = (project: GameProjectMeta) => {
    setConfirmDeleteId(null)
    setPendingRename(createPendingGameProjectRename(project))
  }

  const commitRename = async (project: GameProjectMeta) => {
    const commit = resolveGameProjectRenameCommit(pendingRename, project)
    setPendingRename(null)
    if (!commit) return
    try {
      await window.electronAPI.gameProjectUpdate(workspaceId, commit.projectId, { name: commit.name })
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
      setConfirmDeleteId(null)
      setPendingRename(createPendingGameProjectRename(project))
      navigate(routes.view.studio('game', project.id))
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
      navigate(routes.view.studio('game', next?.id))
    }
  }

  const handleSwitch = (projectId: string) => {
    if (projectId !== currentProjectId) navigate(routes.view.studio('game', projectId))
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
                    onChange={(event) => setPendingRename({ projectId: project.id, draft: event.target.value })}
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
                        setPendingRename(null)
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
  const { workspaces } = useAppShellContext()
  const [creating, setCreating] = useState(false)
  const [prompt, setPrompt] = useState('')
  const creatingRef = useRef(false)

  const workspaceRoot = workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath

  const handleCreate = async (templatePrompt?: string) => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      const finalPrompt = (templatePrompt ?? prompt).trim()
      const project = await window.electronAPI.gameProjectCreate(workspaceId, {
        name: finalPrompt ? finalPrompt.slice(0, 48) : t('gamestudio.defaultProjectName'),
      })
      if (finalPrompt) {
        const projectDir = workspaceRoot ? `${workspaceRoot.replace(/\/$/, '')}/gamestudio/${project.id}` : undefined
        const session = await window.electronAPI.createSession(workspaceId, {
          name: project.name,
          labels: ['gamestudio'],
          workingDirectory: projectDir,
        })
        await window.electronAPI.gameProjectUpdate(workspaceId, project.id, { sessionId: session.id })
        await window.electronAPI.sendMessage(session.id, buildInitialGamePrompt(finalPrompt))
      }
      navigate(routes.view.studio('game', project.id))
    } catch (err) {
      console.error('[GameStudio] Failed to create project:', err)
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full w-full select-none flex-col items-center justify-center bg-[#070914] p-8 text-center text-white">
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(34,211,238,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(168,85,247,.16)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="relative flex w-full max-w-3xl flex-col gap-5 rounded-3xl border border-cyan-300/20 bg-slate-950/80 p-6 shadow-[0_0_60px_rgba(34,211,238,.18)]">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Game Studio</div>
          <h2 className="text-3xl font-semibold tracking-tight">{t('gamestudio.createFirst.title')}</h2>
          <p className="mx-auto max-w-xl text-sm text-slate-300">{t('gamestudio.createFirst.description')}</p>
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Make a low-poly cyberpunk hover racer with boost pads, obstacles, score, and gamepad-like controls…"
          className="min-h-32 resize-none rounded-2xl border border-cyan-300/20 bg-black/40 p-4 text-left text-sm text-white outline-none ring-cyan-300/30 placeholder:text-slate-500 focus:ring-4"
        />
        <div className="flex flex-wrap justify-center gap-2">
          {['Arcade snake with neon trails', 'First-person maze shooter', 'Cozy platformer with coins', 'Low-poly racing prototype', 'Physics puzzle sandbox'].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setPrompt(chip)}
              className="rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1 text-xs text-violet-100 hover:bg-violet-400/20"
            >
              {chip}
            </button>
          ))}
        </div>
        <Button size="lg" disabled={creating} onClick={() => void handleCreate()} className="mx-auto gap-2">
          <Wand2 className="h-4 w-4" />
          {t('gamestudio.createFirst.button')}
        </Button>
      </div>
    </div>
  )
}

function buildInitialGamePrompt(prompt: string): string {
  return `Create this browser game in the current Game Studio project. Use only local files and vendored dependencies already in the project; do not use external CDNs. Keep the game playable in index.html/src/main.js and make frequent checkpoints when a playable version works.\n\nGame request:\n${prompt}`
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
  const { workspaces } = useAppShellContext()
  const [previewRatio, setPreviewRatio] = useState(readPreviewRatio)
  const [paneState, setPaneState] = useState<'starting' | 'ready' | 'error'>('starting')
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [consoleEvents, setConsoleEvents] = useState<GamePaneEvent[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  )
  const workspaceRoot = workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath
  const projectDir = workspaceRoot ? `${workspaceRoot.replace(/\/$/, '')}/gamestudio/${projectId}` : null

  useEffect(() => {
    setSessionId(currentProject?.sessionId ?? null)
  }, [currentProject?.sessionId])

  const syncBounds = useCallback(() => {
    const rect = previewRef.current?.getBoundingClientRect()
    if (!rect) return
    const consoleReserve = consoleOpen ? Math.min(188, Math.max(0, rect.height - 120)) : 0
    void window.electronAPI.gamePane.setBounds(projectId, {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height - consoleReserve,
    })
  }, [consoleOpen, projectId])

  useLayoutEffect(() => {
    const node = previewRef.current
    if (!node) return
    const observer = new ResizeObserver(syncBounds)
    observer.observe(node)
    window.addEventListener('resize', syncBounds)
    syncBounds()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
    }
  }, [syncBounds, previewRatio])

  useEffect(() => {
    let disposed = false
    setPaneState('starting')
    void window.electronAPI.gamePane.start(workspaceId, projectId).then(() => {
      if (!disposed) {
        setPaneState('ready')
        syncBounds()
      }
    }).catch((err) => {
      console.error('[GameStudio] Failed to start preview:', err)
      if (!disposed) setPaneState('error')
    })
    return () => {
      disposed = true
      void window.electronAPI.gamePane.setVisible(projectId, false)
      void window.electronAPI.gamePane.stop(projectId)
    }
  }, [projectId, syncBounds, workspaceId])

  useEffect(() => {
    return window.electronAPI.gamePane.onEvent((event) => {
      if (event.projectId !== projectId) return
      if (event.type === 'state' && event.payload.state === 'ready') setPaneState('ready')
      if (event.type === 'console' || event.type === 'crashed' || event.type === 'unresponsive' || event.type === 'load-failed') {
        setConsoleEvents((prev) => [...prev.slice(-99), event])
        if (event.type !== 'console' || event.payload.level === 'error') setConsoleOpen(true)
        if (event.type === 'console' && event.payload.level === 'error') {
          void window.electronAPI.gameProjectUpdate(workspaceId, projectId, { lastError: event.payload.message }).catch(() => {})
        }
      }
    })
  }, [projectId, workspaceId])

  useEffect(() => {
    return window.electronAPI.onGameProjectChanged((event) => {
      if (event.workspaceId !== workspaceId || event.projectId !== projectId || event.kind !== 'files') return
      void window.electronAPI.gamePane.reload(projectId)
    })
  }, [projectId, workspaceId])

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId
    const session = await window.electronAPI.createSession(workspaceId, {
      name: currentProject?.name ?? t('appMode.gamestudio'),
      labels: ['gamestudio'],
      workingDirectory: projectDir ?? undefined,
    })
    setSessionId(session.id)
    await window.electronAPI.gameProjectUpdate(workspaceId, projectId, { sessionId: session.id })
    return session.id
  }, [currentProject?.name, projectDir, projectId, sessionId, t, workspaceId])

  const recentErrors = useMemo(() => consoleEvents
    .filter((event) => event.type !== 'state')
    .slice(-8)
    .map((event) => {
      if (event.type === 'console') return `[${event.payload.level}] ${event.payload.message}${event.payload.source ? ` (${event.payload.source}:${event.payload.line ?? 0})` : ''}`
      return `[${event.type}] ${JSON.stringify(event.payload ?? {})}`
    })
    .join('\n'), [consoleEvents])

  const sendFixToAgent = useCallback(async () => {
    setBusyAction('fix')
    try {
      const sid = await ensureSession()
      await window.electronAPI.sendMessage(sid, `The Game Studio preview failed. Fix the project files in place and keep dependencies local.\n\nRecent runtime events:\n${recentErrors || '(no console details)'}`)
    } finally {
      setBusyAction(null)
    }
  }, [ensureSession, recentErrors])

  const captureCheckpoint = useCallback(async () => {
    setBusyAction('capture')
    try {
      const dataUrl = await window.electronAPI.gamePane.capture(projectId)
      if (dataUrl) await window.electronAPI.gameProjectUpdate(workspaceId, projectId, { thumbnailPath: dataUrl })
      await window.electronAPI.gameProjectCheckpoint(workspaceId, projectId, true)
    } finally {
      setBusyAction(null)
    }
  }, [projectId, workspaceId])

  const restorePlayable = useCallback(async () => {
    setBusyAction('restore')
    try {
      await window.electronAPI.gameProjectRestore(workspaceId, projectId)
      await window.electronAPI.gamePane.reload(projectId)
    } finally {
      setBusyAction(null)
    }
  }, [projectId, workspaceId])

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
    <div key={projectId} className="relative flex h-full w-full overflow-hidden bg-[#070914] text-slate-100">
      <div
        className="flex min-w-0 flex-col border-r border-cyan-300/20"
        style={{ width: `${previewRatio * 100}%` }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-cyan-300/20 bg-slate-950/90 px-3 shadow-[0_0_24px_rgba(34,211,238,.12)]">
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 gap-2 text-cyan-100 hover:bg-cyan-300/10 hover:text-white"
            onClick={() => setPickerOpen(true)}
            title={t('gamestudio.toolbar.switchProject')}
          >
            <span className="truncate font-medium">{currentProject?.name ?? t('appMode.gamestudio')}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </Button>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => void window.electronAPI.gamePane.reload(projectId)} title="Reload">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void document.documentElement.requestFullscreen?.()} title="Fullscreen">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" disabled={busyAction === 'capture'} onClick={() => void captureCheckpoint()} title="Screenshot + checkpoint">
              <Camera className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" disabled={!projectDir} onClick={() => projectDir && void window.electronAPI.showInFolder(projectDir)} title="Open project folder">
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
          <div ref={previewRef} className="absolute inset-0" />
          {paneState !== 'ready' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950 text-center">
              <div className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100">
                {paneState === 'error' ? 'Preview failed' : 'Booting preview…'}
              </div>
              <p className="max-w-xs text-sm text-slate-400">{t('gamestudio.preview.runPrompt')}</p>
            </div>
          )}
          {consoleOpen && (
            <div className="absolute inset-x-3 bottom-3 z-20 max-h-44 overflow-hidden rounded-xl border border-orange-300/30 bg-slate-950/95 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-orange-100">
                <span className="flex items-center gap-2"><Bug className="h-3.5 w-3.5" /> Runtime console</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7" disabled={busyAction === 'fix'} onClick={() => void sendFixToAgent()}>Fix with agent</Button>
                  <Button variant="ghost" size="sm" className="h-7" disabled={busyAction === 'restore'} onClick={() => void restorePlayable()}><RotateCcw className="h-3.5 w-3.5" /></Button>
                  <button type="button" onClick={() => setConsoleOpen(false)}><X className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap p-3 text-left text-[11px] leading-relaxed text-slate-300">{recentErrors || 'No runtime errors yet.'}</pre>
            </div>
          )}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        className="z-10 w-1.5 cursor-col-resize bg-cyan-300/20 transition-colors hover:bg-cyan-300/60"
        onPointerDown={startDrag}
      />

      <aside className="flex min-w-64 flex-1 flex-col bg-slate-950/80">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-cyan-300/20 px-3 text-sm font-medium text-slate-100">
          <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
            {sessionId ? currentProject?.name : t('gamestudio.chat.placeholderTitle')}
          </div>
          {!sessionId && (
            <Button size="sm" variant="ghost" onClick={() => void ensureSession()}>Attach agent</Button>
          )}
        </div>
        {sessionId ? <ChatPage sessionId={sessionId} /> : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-slate-400">
            {t('gamestudio.chat.placeholderDescription')}
          </div>
        )}
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
    if (mostRecent) navigate(routes.view.studio('game', mostRecent.id))
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
        navigate(routes.view.studio('game', next?.id))
      }
    })
    window.electronAPI.gameProjectGet(workspaceId, projectId).then((project) => {
      if (!disposed && !project) navigate(routes.view.studio('game'))
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
