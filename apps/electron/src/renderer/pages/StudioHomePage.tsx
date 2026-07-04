import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as Icons from 'lucide-react'
import { toast } from 'sonner'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { StudioKind } from '../../shared/types'
import type { StudioRecentArtifact } from '@craft-agent/shared/protocol'

const KIND_CONFIG: Record<StudioKind, { label: string; description: string; icon: typeof Icons.Sparkles }> = {
  canvas: {
    label: 'Canvas',
    description: 'Collect prompts, images, and references on a visual board.',
    icon: Icons.Palette,
  },
  design: {
    label: 'Design',
    description: 'Create prototypes, decks, docs, and visual design artifacts.',
    icon: Icons.PenTool,
  },
  game: {
    label: 'Game',
    description: 'Build and play local browser games with chat repair loops.',
    icon: Icons.Gamepad2,
  },
}

function formatUpdatedAt(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts))
}

export default function StudioHomePage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [creatingKind, setCreatingKind] = useState<StudioKind | null>(null)
  const [recents, setRecents] = useState<StudioRecentArtifact[]>([])

  useEffect(() => {
    if (!workspaceId) {
      setRecents([])
      return
    }
    let disposed = false
    const refresh = () => {
      window.electronAPI.studioListRecents(workspaceId)
        .then((items) => { if (!disposed) setRecents(items) })
        .catch((error) => {
          if (!disposed) toast.error(error instanceof Error ? error.message : 'Failed to load Studio recents')
        })
    }
    refresh()
    const cleanups = [
      window.electronAPI.onCanvasChanged((event) => { if (event.workspaceId === workspaceId) refresh() }),
      window.electronAPI.onDesignProjectChanged((event) => { if (event.workspaceId === workspaceId) refresh() }),
      window.electronAPI.onGameProjectChanged((event) => { if (event.workspaceId === workspaceId) refresh() }),
    ]
    return () => {
      disposed = true
      for (const cleanup of cleanups) cleanup()
    }
  }, [workspaceId])

  const createArtifact = async (kind: StudioKind) => {
    if (!workspaceId) return
    setCreatingKind(kind)
    try {
      if (kind === 'canvas') {
        const doc = await window.electronAPI.canvasCreate(workspaceId, { name: 'Untitled Canvas' })
        navigate(routes.view.studio('canvas', doc.id))
        return
      }
      if (kind === 'design') {
        const project = await window.electronAPI.designProjectCreate(workspaceId, { name: 'Untitled Design' })
        navigate(routes.view.studio('design', project.id))
        return
      }
      const project = await window.electronAPI.gameProjectCreate(workspaceId, { name: 'Untitled Game' })
      navigate(routes.view.studio('game', project.id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create Studio artifact')
    } finally {
      setCreatingKind(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-8 py-10">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icons.Sparkles className="h-4 w-4" strokeWidth={1.7} />
            {t('appMode.studio')}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Create in Studio</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Canvas, Design, and Game are now one Studio surface. Start a new artifact or jump back into recent work.
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          {(['canvas', 'design', 'game'] as const).map((kind) => {
            const config = KIND_CONFIG[kind]
            const Icon = config.icon
            return (
              <button
                key={kind}
                type="button"
                onClick={() => void createArtifact(kind)}
                disabled={creatingKind !== null}
                className={cn(
                  'group rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md',
                  creatingKind !== null && 'cursor-wait opacity-70',
                )}
              >
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" strokeWidth={1.7} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-medium">{config.label}</h2>
                  <Icons.Plus className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" />
                </div>
                <p className="mt-2 text-sm leading-5 text-muted-foreground">{config.description}</p>
              </button>
            )
          })}
        </section>

        <section className="min-h-0 flex-1 rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="font-medium">Recent Studio artifacts</h2>
              <p className="text-sm text-muted-foreground">Sorted across Canvas, Design, and Game by latest update.</p>
            </div>
          </div>
          {recents.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Icons.FolderOpen className="h-8 w-8" strokeWidth={1.5} />
              <p className="text-sm">No Studio artifacts yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recents.map((item) => {
                const config = KIND_CONFIG[item.kind]
                const Icon = config.icon
                return (
                  <button
                    key={`${item.kind}:${item.id}`}
                    type="button"
                    onClick={() => navigate(routes.view.studio(item.kind, item.id))}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-muted/50"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="h-4 w-4" strokeWidth={1.7} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{config.label}</div>
                    </div>
                    {item.sessionId ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          navigate(routes.view.allSessions(item.sessionId!))
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          event.stopPropagation()
                          navigate(routes.view.allSessions(item.sessionId!))
                        }}
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                      >
                        Chat
                      </span>
                    ) : null}
                    <div className="hidden text-xs text-muted-foreground sm:block">{formatUpdatedAt(item.updatedAt)}</div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
