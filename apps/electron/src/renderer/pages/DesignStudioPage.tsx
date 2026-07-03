import { useEffect, useMemo, useRef, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatDistanceToNowStrict } from 'date-fns'
import type { Locale } from 'date-fns'
import { Check, FolderOpen, LayoutGrid, Pencil, PenTool, Plus, Trash2, X } from 'lucide-react'
import { getDateLocale } from '@craft-agent/shared/i18n'
import type { DesignProjectMeta } from '@craft-agent/shared/protocol'
import { Button } from '@/components/ui/button'
import {
  createPendingDesignProjectRename,
  designProjectsAtom,
  mostRecentDesignProject,
  pendingDesignProjectRenameAtom,
  resolveDesignProjectRenameCommit,
  sortDesignProjectsByUpdatedAtDesc,
} from '@/atoms/design'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'

export interface DesignStudioPageProps {
  workspaceId: string
  projectId: string | null
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
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-foreground/50 transition-colors duration-100 hover:bg-foreground/5',
        destructive ? 'hover:text-destructive' : 'hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function useRefreshDesignProjects(workspaceId: string) {
  const setProjects = useSetAtom(designProjectsAtom)
  return async () => {
    if (!workspaceId) return
    const projects = await window.electronAPI.designProjectList(workspaceId)
    setProjects(projects || [])
  }
}

function DesignProjectGallery({
  workspaceId,
  projects,
  currentProjectId,
  compact = false,
  onOpenProject,
}: {
  workspaceId: string
  projects: readonly DesignProjectMeta[]
  currentProjectId?: string | null
  compact?: boolean
  onOpenProject?: () => void
}) {
  const { t, i18n } = useTranslation()
  const dateLocale = getDateLocale(i18n.resolvedLanguage ?? 'en') as Locale | undefined
  const sortedProjects = useMemo(() => sortDesignProjectsByUpdatedAtDesc(projects), [projects])
  const [pendingRename, setPendingRename] = useAtom(pendingDesignProjectRenameAtom)
  const [deleteTarget, setDeleteTarget] = useState<DesignProjectMeta | null>(null)
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false)
  const refreshProjects = useRefreshDesignProjects(workspaceId)

  const startRename = (project: DesignProjectMeta) => {
    setPendingRename(createPendingDesignProjectRename(project))
  }

  const commitRename = async (project: DesignProjectMeta) => {
    const commit = resolveDesignProjectRenameCommit(pendingRename, project)
    setPendingRename(null)
    if (!commit) return
    try {
      await window.electronAPI.designProjectUpdate(workspaceId, commit.projectId, { name: commit.name })
    } catch (err) {
      toast.error(t('design.error.rename'), {
        description: err instanceof Error ? err.message : undefined,
      })
      try {
        await refreshProjects()
      } catch (refreshErr) {
        console.error('[Design] Failed to reconcile projects after rename error:', refreshErr)
      }
    }
  }

  const handleCreate = async () => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      const project = await window.electronAPI.designProjectCreate(workspaceId, {
        name: t('design.defaultProjectName'),
      })
      setPendingRename(createPendingDesignProjectRename(project))
      navigate(routes.view.design(project.id))
      onOpenProject?.()
    } catch (err) {
      toast.error(t('design.error.create'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const targetId = deleteTarget.id
    const remaining = sortedProjects.filter((project) => project.id !== targetId)
    setDeleteTarget(null)
    try {
      await window.electronAPI.designProjectDelete(workspaceId, targetId)
      await refreshProjects()
      if (targetId === currentProjectId) {
        navigate(routes.view.design())
      }
    } catch (err) {
      toast.error(t('design.error.delete'), {
        description: err instanceof Error ? err.message : undefined,
      })
      try {
        await refreshProjects()
      } catch (refreshErr) {
        console.error('[Design] Failed to reconcile projects after delete error:', refreshErr)
      }
      if (targetId === currentProjectId) {
        const next = mostRecentDesignProject(remaining)
        navigate(routes.view.design(next?.id))
      }
    }
  }

  const openProject = (id: string) => {
    navigate(routes.view.design(id))
    onOpenProject?.()
  }

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col', compact ? 'bg-background' : 'bg-background')}>
      <div className={cn('flex shrink-0 items-center justify-between border-b border-border', compact ? 'px-4 py-3' : 'px-8 py-5')}>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-foreground">{t('design.gallery.title')}</h2>
          <p className="truncate text-xs text-muted-foreground">{t('design.gallery.description')}</p>
        </div>
        <Button size="sm" disabled={creating} onClick={() => void handleCreate()}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('design.gallery.create')}
        </Button>
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto', compact ? 'p-3' : 'p-8')}>
        <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-[repeat(auto-fill,minmax(220px,1fr))]')}>
          {sortedProjects.map((project) => {
            const renaming = pendingRename?.projectId === project.id
            return (
              <div
                key={project.id}
                role="button"
                tabIndex={0}
                onClick={() => !renaming && openProject(project.id)}
                onKeyDown={(event) => {
                  if (renaming) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openProject(project.id)
                  }
                }}
                className={cn(
                  'group flex min-w-0 cursor-default flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-minimal transition-colors hover:border-foreground/20',
                  currentProjectId === project.id && 'border-primary/50',
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <PenTool className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {renaming ? (
                      <input
                        autoFocus
                        value={pendingRename.draft}
                        placeholder={t('design.gallery.renamePlaceholder')}
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
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setPendingRename(null)
                          }
                        }}
                        className="w-full min-w-0 rounded-[5px] bg-foreground/5 px-2 py-1 text-sm text-foreground outline-none"
                      />
                    ) : (
                      <div className="truncate text-sm font-medium text-foreground" title={project.name}>
                        {project.name}
                      </div>
                    )}
                    <div className="truncate text-xs text-muted-foreground">
                      {formatDistanceToNowStrict(new Date(project.updatedAt), {
                        addSuffix: true,
                        locale: dateLocale,
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-muted-foreground">{project.kind}</span>
                  <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:duration-100 sm:group-hover:opacity-100">
                    {renaming ? (
                      <>
                        <RowIconButton label={t('common.save')} onClick={() => void commitRename(project)}>
                          <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </RowIconButton>
                        <RowIconButton label={t('common.cancel')} onClick={() => setPendingRename(null)}>
                          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </RowIconButton>
                      </>
                    ) : (
                      <>
                        <RowIconButton label={t('common.rename')} onClick={() => startRename(project)}>
                          <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </RowIconButton>
                        <RowIconButton label={t('common.delete')} destructive onClick={() => setDeleteTarget(project)}>
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </RowIconButton>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {deleteTarget && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="design-delete-title"
            className="w-full max-w-sm rounded-xl border border-border bg-popover p-4 shadow-modal-small"
          >
            <div className="flex flex-col gap-1">
              <h3 id="design-delete-title" className="text-sm font-medium text-foreground">
                {t('design.delete.title')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t('design.delete.description', { name: deleteTarget.name })}
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" onClick={() => void handleDelete()}>
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DesignEmptyState({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const setPendingRename = useSetAtom(pendingDesignProjectRenameAtom)
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false)

  const handleCreate = async () => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      const project = await window.electronAPI.designProjectCreate(workspaceId, {
        name: t('design.defaultProjectName'),
      })
      setPendingRename(createPendingDesignProjectRename(project))
      navigate(routes.view.design(project.id))
    } catch (err) {
      toast.error(t('design.error.create'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full w-full select-none flex-col items-center justify-center gap-3 bg-background text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
        <PenTool className="h-5 w-5" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{t('design.createFirst.title')}</h2>
        <p className="max-w-sm text-xs text-muted-foreground">{t('design.createFirst.description')}</p>
      </div>
      <Button size="sm" disabled={creating} onClick={() => void handleCreate()}>
        {t('design.createFirst.button')}
      </Button>
    </div>
  )
}

function DesignProjectShell({
  workspaceId,
  projectId,
  projects,
}: {
  workspaceId: string
  projectId: string
  projects: readonly DesignProjectMeta[]
}) {
  const { t } = useTranslation()
  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  )
  const [galleryOpen, setGalleryOpen] = useState(false)

  return (
    <div key={projectId} className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/60 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 gap-2"
            onClick={() => setGalleryOpen(true)}
            title={t('design.toolbar.openGallery')}
          >
            <LayoutGrid className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="truncate font-medium" title={currentProject?.name ?? undefined}>
              {currentProject?.name ?? t('appMode.design')}
            </span>
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-6">
        <div className="flex max-w-sm flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground">
            <FolderOpen className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <h3 className="text-sm font-medium text-foreground">{currentProject?.name ?? t('appMode.design')}</h3>
          <p className="text-xs text-muted-foreground">{t('design.project.ready')}</p>
        </div>
      </div>
      {galleryOpen && (
        <div
          className="absolute inset-0 z-20 flex items-start justify-center bg-black/20 p-8"
          onClick={() => setGalleryOpen(false)}
        >
          <div
            role="dialog"
            aria-label={t('design.gallery.title')}
            className="popover-styled flex max-h-full w-full max-w-4xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <DesignProjectGallery
              workspaceId={workspaceId}
              projects={projects}
              currentProjectId={projectId}
              compact
              onOpenProject={() => setGalleryOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default function DesignStudioPage({ workspaceId, projectId }: DesignStudioPageProps) {
  const projects = useAtomValue(designProjectsAtom)
  const store = useStore()

  useEffect(() => {
    if (projectId || !workspaceId || !projects) return
    const mostRecent = mostRecentDesignProject(projects)
    if (mostRecent) navigate(routes.view.design(mostRecent.id))
  }, [projectId, workspaceId, projects])

  useEffect(() => {
    if (!workspaceId || !projectId) return
    let disposed = false
    const cleanup = window.electronAPI.onDesignProjectChanged((event) => {
      if (event.workspaceId !== workspaceId || event.projectId !== projectId) return
      if (event.kind === 'deleted') {
        const remaining = (store.get(designProjectsAtom) ?? []).filter((p) => p.id !== projectId)
        const next = mostRecentDesignProject(remaining)
        navigate(routes.view.design(next?.id))
      }
    })
    window.electronAPI.designProjectGet(workspaceId, projectId).then((project) => {
      if (!disposed && !project) navigate(routes.view.design())
    }).catch((err) => {
      console.error('[Design] Failed to load project:', err)
    })
    return () => {
      disposed = true
      cleanup()
    }
  }, [workspaceId, projectId, store])

  if (!projectId) {
    if (!projects || projects.length > 0) return null
    return (
      <div data-testid="design-studio-page" data-workspace-id={workspaceId}>
        <DesignEmptyState workspaceId={workspaceId} />
      </div>
    )
  }

  return (
    <div
      className="h-full w-full"
      data-testid="design-studio-page"
      data-workspace-id={workspaceId}
      data-project-id={projectId}
    >
      <DesignProjectShell
        workspaceId={workspaceId}
        projectId={projectId}
        projects={projects ?? []}
      />
    </div>
  )
}
