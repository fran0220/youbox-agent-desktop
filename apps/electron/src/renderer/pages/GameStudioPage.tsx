import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent, type SetStateAction } from 'react'
import { useAtom, useAtomValue, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNowStrict } from 'date-fns'
import type { Locale } from 'date-fns'
import { Check, ChevronDown, History, Loader2, MessageSquare, Pencil, Plus, RotateCw, Send, Trash2, X } from 'lucide-react'
import { getDateLocale } from '@craft-agent/shared/i18n'
import { Button } from '@/components/ui/button'
import {
  createPendingGameProjectRename,
  gamestudioChatSessionIdsAtom,
  gamestudioProjectsAtom,
  mostRecentGameProject,
  pendingGameProjectRenameAtom,
  resolveGameProjectRenameCommit,
  sortGameProjectsByUpdatedAtDesc,
} from '@/atoms/gamestudio'
import { useAppShellContext } from '@/context/AppShellContext'
import {
  buildGameStudioSessionCreateOptions,
  createGamePreviewRefreshScheduler,
  resolveGameProjectDir,
  sessionMessagesToGameStudioChatMessages,
  type GameStudioChatMessage,
} from '@/lib/gamestudio-chat'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { GamePaneEvent, GamePaneRuntimeErrorPayload, GameProjectMeta, SessionEvent } from '@craft-agent/shared/protocol'

const SPLIT_STORAGE_KEY = 'gamestudio.previewSplitRatio'
const DEFAULT_PREVIEW_RATIO = 0.68
const MIN_PREVIEW_RATIO = 0.45
const MAX_PREVIEW_RATIO = 0.82
const PREVIEW_REFRESH_DELAY_MS = 250
const AUTO_FIX_COOLDOWN_MS = 30_000

interface QueuedGamePrompt {
  id: number
  text: string
}

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

function appendAssistantDelta(messages: GameStudioChatMessage[], delta: string): GameStudioChatMessage[] {
  if (messages.length === 0 || messages[messages.length - 1]?.role !== 'assistant') {
    return [...messages, { role: 'assistant', text: delta }]
  }
  const next = [...messages]
  const last = next[next.length - 1]
  next[next.length - 1] = { ...last, text: last.text + delta }
  return next
}

function replaceAssistantText(messages: GameStudioChatMessage[], text: string): GameStudioChatMessage[] {
  if (messages.length === 0 || messages[messages.length - 1]?.role !== 'assistant') {
    return [...messages, { role: 'assistant', text }]
  }
  const next = [...messages]
  next[next.length - 1] = { role: 'assistant', text }
  return next
}

function formatRuntimeErrorForAgent(error: GamePaneRuntimeErrorPayload): string {
  const location = error.source?.fileName
    ? `${error.source.fileName}${error.source.lineNumber ? `:${error.source.lineNumber}` : ''}${error.source.columnNumber ? `:${error.source.columnNumber}` : ''}`
    : 'unknown source'
  const recent = error.recentConsole.length > 0
    ? error.recentConsole.map((entry) => `[${entry.level}] ${entry.message}`).join('\n')
    : 'No recent console logs.'
  return `The game preview reported a runtime error. Please inspect and fix the project so it is playable again.

Message:
${error.message}

Location:
${location}

Stack:
${error.stack ?? 'No stack trace.'}

Recent console:
${recent}`
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

function GameProjectThumbnail({ project }: { project: GameProjectMeta }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    setSrc(null)
    if (!project.thumbnailPath) return
    window.electronAPI.readFilePreviewDataUrl(project.thumbnailPath, 320)
      .then((dataUrl) => {
        if (!disposed) setSrc(dataUrl)
      })
      .catch(() => {
        if (!disposed) setSrc(null)
      })
    return () => {
      disposed = true
    }
  }, [project.thumbnailPath])

  return (
    <div className="aspect-video overflow-hidden rounded-[7px] border border-white/10 bg-slate-950">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(56,189,248,0.22),transparent_34%),radial-gradient(circle_at_70%_65%,rgba(168,85,247,0.18),transparent_38%),#020617] text-[10px] uppercase tracking-[0.18em] text-white/45">
          Game
        </div>
      )}
    </div>
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
      navigate(routes.view.gamestudio(project.id))
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
        className="popover-styled flex max-h-[76%] w-[540px] flex-col overflow-hidden"
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
        <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto p-2">
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
                'group cursor-default rounded-[9px] border p-1.5 transition-colors duration-100',
                project.id === currentProjectId ? 'border-primary/50 bg-primary/10' : 'border-foreground/10 hover:bg-foreground/5',
              )}
            >
              <GameProjectThumbnail project={project} />
              {renamingId === project.id ? (
                <div className="mt-2 flex min-w-0 items-center gap-1">
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
                <div className="mt-2 min-w-0">
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
                <div className="mt-2 flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
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
                  <div className="mt-1 flex items-center justify-end gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
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
  const [prompt, setPrompt] = useState('')
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false)

  const workspaceRootPath = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId || workspace.name === workspaceId)?.rootPath ?? null,
    [workspaces, workspaceId],
  )

  const handleCreate = async (initialPrompt?: string) => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      const trimmedPrompt = initialPrompt?.trim() ?? ''
      if (trimmedPrompt && !workspaceRootPath) {
        throw new Error(t('gamestudio.chat.missingProjectDir'))
      }
      const project = await window.electronAPI.gameProjectCreate(workspaceId, {
        name: trimmedPrompt ? trimmedPrompt.slice(0, 60) : t('gamestudio.defaultProjectName'),
      })
      if (trimmedPrompt && workspaceRootPath) {
        const projectDir = resolveGameProjectDir(workspaceRootPath, project.id)
        const session = await window.electronAPI.createSession(
          workspaceId,
          buildGameStudioSessionCreateOptions(projectDir),
        )
        try {
          await window.electronAPI.gameProjectUpdate(workspaceId, project.id, { sessionId: session.id })
        } catch (err) {
          try { await window.electronAPI.deleteSession(session.id) } catch { /* best-effort cleanup */ }
          throw err
        }
        await window.electronAPI.sendMessage(session.id, trimmedPrompt, undefined, undefined, { skillSlugs: ['gameblocks'] })
      }
      navigate(routes.view.gamestudio(project.id))
    } catch (err) {
      console.error('[GameStudio] Failed to create project:', err)
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  const handleTemplateCreate = async (template: string, name: string) => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      const project = await window.electronAPI.gameProjectCreate(workspaceId, { name, template })
      navigate(routes.view.gamestudio(project.id))
    } catch (err) {
      console.error('[GameStudio] Failed to create template project:', err)
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full w-full select-none flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{t('gamestudio.createFirst.title')}</h2>
        <p className="max-w-sm text-xs text-muted-foreground">{t('gamestudio.createFirst.description')}</p>
      </div>
      <div className="flex w-full max-w-xl flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('gamestudio.createFirst.promptPlaceholder')}
          className="min-h-28 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'runner', label: t('gamestudio.createFirst.templateRunner') },
              { id: 'shooter', label: t('gamestudio.createFirst.templateShooter') },
              { id: 'puzzle', label: t('gamestudio.createFirst.templatePuzzle') },
            ].map((template) => (
              <button
                key={template.id}
                type="button"
                disabled={creating}
                onClick={() => void handleTemplateCreate(template.id, template.label)}
                className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {template.label}
              </button>
            ))}
          </div>
          <Button size="sm" disabled={creating || (!!prompt.trim() && !workspaceRootPath)} onClick={() => void handleCreate(prompt)}>
            {creating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {prompt.trim() ? t('gamestudio.createFirst.generateButton') : t('gamestudio.createFirst.button')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function GamePreview({ workspaceId, projectId, nativeHidden }: { workspaceId: string; projectId: string; nativeHidden: boolean }) {
  const { t } = useTranslation()
  const useNativePane = window.electronAPI.getRuntimeEnvironment() === 'electron'
  const [port, setPort] = useState<number | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const reload = useCallback(() => {
    if (useNativePane) {
      void window.electronAPI.gamePane.reload(projectId)
    } else {
      setReloadToken((value) => value + 1)
    }
  }, [projectId, useNativePane])

  const syncBounds = useCallback(() => {
    if (!useNativePane || !hostRef.current) return
    const rect = hostRef.current.getBoundingClientRect()
    void window.electronAPI.gamePane.setBounds(projectId, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    })
  }, [projectId, useNativePane])

  useEffect(() => {
    if (!useNativePane) return
    const node = hostRef.current
    if (!node) return
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(syncBounds)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(node)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [syncBounds, useNativePane])

  useEffect(() => {
    if (!useNativePane || !port) return
    void window.electronAPI.gamePane.setVisible(projectId, !nativeHidden)
    if (!nativeHidden) syncBounds()
  }, [projectId, nativeHidden, port, syncBounds, useNativePane])

  useEffect(() => {
    if (!useNativePane) return
    const cleanup = window.electronAPI.gamePane.onEvent((event) => {
      if (event.projectId !== projectId) return
      if (event.type === 'load-failed') {
        const payload = event.payload as { errorDescription?: string } | undefined
        setError(payload?.errorDescription ?? t('gamestudio.preview.statusError'))
      }
    })
    return cleanup
  }, [projectId, t, useNativePane])

  useEffect(() => {
    let disposed = false
    setPort(null)
    setError(null)
    window.electronAPI.gamePane.start(workspaceId, projectId)
      .then((result) => {
        if (!disposed) setPort(result.port)
      })
      .catch((err) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      disposed = true
      void window.electronAPI.gamePane.stop(projectId)
    }
  }, [workspaceId, projectId])

  useEffect(() => {
    const scheduler = createGamePreviewRefreshScheduler({ delayMs: PREVIEW_REFRESH_DELAY_MS, refresh: reload })
    const cleanup = window.electronAPI.onGameProjectChanged((event) => {
      if (event.workspaceId === workspaceId && event.projectId === projectId && event.kind === 'files') {
        scheduler.schedule()
      }
    })
    return () => {
      scheduler.cancel()
      cleanup()
    }
  }, [workspaceId, projectId, reload])

  const src = port ? `http://127.0.0.1:${port}/?reload=${reloadToken}` : null

  return (
    <div ref={hostRef} className="relative flex min-h-0 flex-1 flex-col bg-slate-950">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-black/40 p-1 backdrop-blur">
        <button
          type="button"
          onClick={reload}
          disabled={!src}
          title={t('gamestudio.toolbar.reload')}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t('gamestudio.toolbar.reload')}
        </button>
      </div>
      {useNativePane && port && !error ? (
        <div className="flex h-full items-center justify-center bg-slate-950 text-xs text-white/50">
          {nativeHidden ? t('gamestudio.preview.nativeHidden') : t('gamestudio.preview.nativeReady')}
        </div>
      ) : src ? (
        <iframe
          ref={iframeRef}
          key={src}
          title={t('gamestudio.preview.title')}
          src={src}
          sandbox="allow-scripts allow-pointer-lock allow-same-origin"
          className="h-full w-full border-0 bg-slate-950"
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-white/70">
          {error ? (
            <>
              <div className="rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-xs text-red-200">
                {t('gamestudio.preview.statusError')}
              </div>
              <p className="max-w-sm text-xs text-red-100/80">{error}</p>
            </>
          ) : (
            <>
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.5} />
              <p className="text-xs">{t('gamestudio.preview.statusStarting')}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function GameRuntimeConsolePanel({
  events,
  onFixError,
}: {
  events: readonly GamePaneEvent[]
  onFixError: (error: GamePaneRuntimeErrorPayload) => void
}) {
  const { t } = useTranslation()
  const latestError = [...events].reverse().find((event): event is Extract<GamePaneEvent, { type: 'runtime-error' }> => event.type === 'runtime-error')
  const visibleEvents = events.slice(-6)

  return (
    <div className="flex max-h-40 min-h-28 shrink-0 flex-col border-t border-white/10 bg-slate-950 text-white/80">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-white/60">{t('gamestudio.console.title')}</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!latestError}
          className="h-6 px-2 text-[11px] text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-40"
          onClick={() => latestError && onFixError(latestError.payload)}
        >
          {t('gamestudio.console.sendToAgent')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {visibleEvents.length === 0 ? (
          <div className="text-white/35">{t('gamestudio.console.empty')}</div>
        ) : (
          visibleEvents.map((event, index) => {
            const isError = event.type === 'runtime-error' || (event.type === 'console' && event.payload.level === 'error')
            const isWarn = event.type === 'console' && event.payload.level === 'warn'
            const message = event.type === 'runtime-error'
              ? event.payload.message
              : event.type === 'console'
                ? event.payload.message
                : event.type
            return (
              <div
                key={`${event.type}-${index}`}
                className={cn(
                  'truncate',
                  isError ? 'text-red-300' : isWarn ? 'text-amber-300' : 'text-white/65',
                )}
              >
                <span className="text-white/35">[{event.type}]</span> {message}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function GameStudioChatPanel({
  workspaceId,
  projectId,
  projectDir,
  persistedSessionId,
  queuedPrompt,
  onQueuedPromptHandled,
  onTurnComplete,
}: {
  workspaceId: string
  projectId: string
  projectDir: string | null
  persistedSessionId: string | null
  queuedPrompt: QueuedGamePrompt | null
  onQueuedPromptHandled: (id: number) => void
  onTurnComplete: () => void
}) {
  const { t } = useTranslation()
  const [sessionIds, setSessionIds] = useAtom(gamestudioChatSessionIdsAtom)
  const resolvedSessionId = sessionIds[projectId] ?? persistedSessionId ?? null
  const [messages, setMessages] = useState<GameStudioChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const sessionIdRef = useRef<string | null>(resolvedSessionId)
  const verifiedSessionIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionIdRef.current = resolvedSessionId
  }, [resolvedSessionId])

  useEffect(() => {
    verifiedSessionIdRef.current = null
    setMessages([])
    setStreaming(false)
  }, [projectId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming, loadingHistory])

  useEffect(() => {
    const existing = resolvedSessionId
    if (!existing) return
    let disposed = false
    setLoadingHistory(true)
    window.electronAPI.getSessionMessages(existing)
      .then((session) => {
        if (disposed) return
        if (session) {
          verifiedSessionIdRef.current = existing
          setMessages(sessionMessagesToGameStudioChatMessages(session.messages))
          setStreaming(session.isProcessing)
        } else {
          sessionIdRef.current = null
          setSessionIds((prev) => {
            const next = { ...prev }
            delete next[projectId]
            return next
          })
        }
      })
      .catch((err) => {
        if (!disposed) console.error('[GameStudio] Failed to load chat history:', err)
      })
      .finally(() => {
        if (!disposed) setLoadingHistory(false)
      })
    return () => {
      disposed = true
    }
  }, [projectId, resolvedSessionId, setSessionIds])

  useEffect(() => {
    const cleanup = window.electronAPI.onSessionEvent((event: SessionEvent) => {
      if (event.sessionId !== sessionIdRef.current) return
      if (event.type === 'text_delta') {
        setMessages((prev) => appendAssistantDelta(prev, event.delta))
      } else if (event.type === 'text_complete') {
        if (!event.isIntermediate) setMessages((prev) => replaceAssistantText(prev, event.text))
      } else if (event.type === 'complete') {
        setStreaming(false)
        onTurnComplete()
      } else if (event.type === 'error') {
        setMessages((prev) => replaceAssistantText(prev, event.error))
        setStreaming(false)
      } else if (event.type === 'typed_error') {
        setMessages((prev) => replaceAssistantText(prev, event.error.message))
        setStreaming(false)
      }
    })
    return cleanup
  }, [onTurnComplete])

  const ensureSession = useCallback(async (): Promise<string> => {
    const existing = sessionIdRef.current
    if (existing) {
      if (verifiedSessionIdRef.current === existing) return existing
      const loaded = await window.electronAPI.getSessionMessages(existing)
      if (loaded) {
        verifiedSessionIdRef.current = existing
        setMessages(sessionMessagesToGameStudioChatMessages(loaded.messages))
        setStreaming(loaded.isProcessing)
        return existing
      }
    }
    if (!projectDir) throw new Error(t('gamestudio.chat.missingProjectDir'))
    const session = await window.electronAPI.createSession(
      workspaceId,
      buildGameStudioSessionCreateOptions(projectDir),
    )
    try {
      await window.electronAPI.gameProjectUpdate(workspaceId, projectId, { sessionId: session.id })
    } catch (err) {
      try { await window.electronAPI.deleteSession(session.id) } catch { /* best-effort cleanup */ }
      throw err
    }
    sessionIdRef.current = session.id
    verifiedSessionIdRef.current = session.id
    setSessionIds((prev) => ({ ...prev, [projectId]: session.id }))
    return session.id
  }, [workspaceId, projectId, projectDir, setSessionIds, t])

  const sendText = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return false
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }, { role: 'assistant', text: '' }])
    setStreaming(true)
    try {
      const sessionId = await ensureSession()
      await window.electronAPI.sendMessage(sessionId, trimmed, undefined, undefined, { skillSlugs: ['gameblocks'] })
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessages((prev) => replaceAssistantText(prev, msg))
      setStreaming(false)
      return false
    }
  }, [ensureSession, streaming])

  useEffect(() => {
    if (!queuedPrompt || streaming) return
    void sendText(queuedPrompt.text).finally(() => onQueuedPromptHandled(queuedPrompt.id))
  }, [queuedPrompt, onQueuedPromptHandled, sendText, streaming])

  const handleSend = useCallback(async () => {
    await sendText(input)
  }, [input, sendText])

  return (
    <aside className="flex min-w-64 flex-1 flex-col bg-card/40">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 text-sm font-medium text-foreground">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        {t('gamestudio.chat.title')}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {loadingHistory ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
            {t('gamestudio.chat.loading')}
          </span>
        ) : messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('gamestudio.chat.empty')}</p>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {msg.role === 'user' ? t('gamestudio.chat.you') : t('gamestudio.chat.assistant')}
              </span>
              {msg.text ? (
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">{msg.text}</p>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                  {t('gamestudio.chat.thinking')}
                </span>
              )}
            </div>
          ))
        )}
      </div>
      <div className="border-t border-border p-3">
        <div className="flex gap-2 rounded-lg border border-border bg-background p-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSend()
              }
            }}
            placeholder={t('gamestudio.chat.placeholder')}
            className="min-h-16 flex-1 resize-none bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Button size="icon" className="h-8 w-8 self-end" disabled={!input.trim() || streaming} onClick={() => void handleSend()}>
            {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </aside>
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
  const { workspaces } = useAppShellContext()
  const [previewRatio, setPreviewRatio] = useState(readPreviewRatio)
  const [runtimeEvents, setRuntimeEvents] = useState<GamePaneEvent[]>([])
  const [queuedPrompt, setQueuedPrompt] = useState<QueuedGamePrompt | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [draggingSplit, setDraggingSplit] = useState(false)
  const lastAutoFixAtRef = useRef(0)
  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  )
  const workspaceRootPath = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId || workspace.name === workspaceId)?.rootPath ?? null,
    [workspaces, workspaceId],
  )
  const projectDir = useMemo(
    () => workspaceRootPath ? resolveGameProjectDir(workspaceRootPath, projectId) : null,
    [workspaceRootPath, projectId],
  )

  useEffect(() => {
    setRuntimeEvents([])
    setQueuedPrompt(null)
  }, [projectId])

  useEffect(() => {
    const cleanup = window.electronAPI.gamePane.onEvent((event) => {
      if (event.projectId !== projectId) return
      setRuntimeEvents((prev) => [...prev, event].slice(-80))
      if (event.type === 'runtime-error' && currentProject?.autoFix) {
        const now = Date.now()
        if (now - lastAutoFixAtRef.current >= AUTO_FIX_COOLDOWN_MS) {
          lastAutoFixAtRef.current = now
          setQueuedPrompt({ id: now, text: formatRuntimeErrorForAgent(event.payload) })
        }
      }
    })
    return cleanup
  }, [currentProject?.autoFix, projectId])

  const queueFixPrompt = useCallback((error: GamePaneRuntimeErrorPayload) => {
    setQueuedPrompt({ id: Date.now(), text: formatRuntimeErrorForAgent(error) })
  }, [])

  const checkpointProject = useCallback(() => {
    void (async () => {
      try {
        await window.electronAPI.gameProjectCheckpoint(workspaceId, projectId)
        const thumbnailPath = await window.electronAPI.gamePane.capture(projectId)
        if (thumbnailPath) {
          await window.electronAPI.gameProjectUpdate(workspaceId, projectId, { thumbnailPath })
        }
      } catch (err) {
        console.error('[GameStudio] Failed to checkpoint project:', err)
      }
    })()
  }, [workspaceId, projectId])

  const restoreProject = useCallback(async () => {
    if (!currentProject?.lastPlayableCommit || restoring) return
    setRestoring(true)
    try {
      await window.electronAPI.gameProjectRestore(workspaceId, projectId)
    } catch (err) {
      console.error('[GameStudio] Failed to restore project checkpoint:', err)
    } finally {
      setRestoring(false)
    }
  }, [workspaceId, projectId, currentProject?.lastPlayableCommit, restoring])

  const toggleAutoFix = useCallback(async () => {
    if (!currentProject) return
    try {
      await window.electronAPI.gameProjectUpdate(workspaceId, projectId, { autoFix: !currentProject.autoFix })
    } catch (err) {
      console.error('[GameStudio] Failed to update auto-fix setting:', err)
    }
  }, [currentProject, workspaceId, projectId])

  const exportProject = useCallback(async () => {
    try {
      await window.electronAPI.gameProjectExportZip(workspaceId, projectId)
    } catch (err) {
      console.error('[GameStudio] Failed to export project:', err)
    }
  }, [workspaceId, projectId])

  const importProject = useCallback(async () => {
    try {
      const [zipPath] = await window.electronAPI.openFileDialog()
      if (!zipPath) return
      const project = await window.electronAPI.gameProjectCreate(workspaceId, {
        name: t('gamestudio.defaultImportedProjectName'),
      })
      await window.electronAPI.gameProjectImportZip(workspaceId, project.id, zipPath)
      navigate(routes.view.gamestudio(project.id))
    } catch (err) {
      console.error('[GameStudio] Failed to import project:', err)
    }
  }, [workspaceId, t])

  const startDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.parentElement
    if (!container) return
    setDraggingSplit(true)
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
      setDraggingSplit(false)
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
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground">{t('gamestudio.preview.autoLifecycle')}</div>
            <Button
              variant="ghost"
              size="sm"
              title={t('gamestudio.toolbar.importZip')}
              onClick={() => void importProject()}
            >
              {t('gamestudio.toolbar.importZip')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title={t('gamestudio.toolbar.exportZip')}
              onClick={() => void exportProject()}
            >
              {t('gamestudio.toolbar.exportZip')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled
              title={t('gamestudio.toolbar.shareSoonDescription')}
            >
              {t('gamestudio.toolbar.shareSoon')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title={t('gamestudio.toolbar.autoFix')}
              onClick={() => void toggleAutoFix()}
              className={currentProject?.autoFix ? 'text-primary' : undefined}
            >
              {currentProject?.autoFix ? t('gamestudio.toolbar.autoFixOn') : t('gamestudio.toolbar.autoFixOff')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!currentProject?.lastPlayableCommit || restoring}
              title={t('gamestudio.toolbar.restore')}
              onClick={() => void restoreProject()}
            >
              {restoring ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <History className="mr-1.5 h-3.5 w-3.5" />}
              {t('gamestudio.toolbar.restore')}
            </Button>
          </div>
        </div>

        <GamePreview workspaceId={workspaceId} projectId={projectId} nativeHidden={pickerOpen || draggingSplit} />
        <GameRuntimeConsolePanel events={runtimeEvents} onFixError={queueFixPrompt} />
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        className="z-10 w-1.5 cursor-col-resize bg-border/50 transition-colors hover:bg-primary/60"
        onPointerDown={startDrag}
      />

      <GameStudioChatPanel
        workspaceId={workspaceId}
        projectId={projectId}
        projectDir={projectDir}
        persistedSessionId={currentProject?.sessionId ?? null}
        queuedPrompt={queuedPrompt}
        onQueuedPromptHandled={(id) => setQueuedPrompt((current) => current?.id === id ? null : current)}
        onTurnComplete={checkpointProject}
      />

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
  const { t } = useTranslation()
  const { workspaces } = useAppShellContext()
  const projects = useAtomValue(gamestudioProjectsAtom)
  const store = useStore()
  const [pickerOpen, setPickerOpen] = useState(false)
  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId || workspace.name === workspaceId) ?? null,
    [workspaces, workspaceId],
  )
  const isRemoteWorkspace = Boolean(currentWorkspace?.remoteServer)

  // Bare gamestudio route: open the most recently updated project once the
  // project list is known. NavigationContext usually does this synchronously;
  // this covers the async list-loading case.
  useEffect(() => {
    if (isRemoteWorkspace || projectId || !workspaceId || !projects) return
    const mostRecent = mostRecentGameProject(projects)
    if (mostRecent) navigate(routes.view.gamestudio(mostRecent.id))
  }, [isRemoteWorkspace, projectId, workspaceId, projects])

  // Stale/deleted project id fallback, mirroring CanvasPage. The page never
  // renders a crash state for a missing route target; it falls back to the bare
  // route so the normal most-recent/empty-state logic takes over.
  useEffect(() => {
    if (isRemoteWorkspace || !workspaceId || !projectId) return
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
  }, [isRemoteWorkspace, workspaceId, projectId, store])

  if (isRemoteWorkspace) {
    return (
      <div className="flex h-full w-full select-none flex-col items-center justify-center gap-2 p-6 text-center">
        <h2 className="text-sm font-medium text-foreground">{t('gamestudio.remoteUnsupported.title')}</h2>
        <p className="max-w-sm text-xs text-muted-foreground">{t('gamestudio.remoteUnsupported.description')}</p>
      </div>
    )
  }

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
