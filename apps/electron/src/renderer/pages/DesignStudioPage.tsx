import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatDistanceToNowStrict } from 'date-fns'
import type { Locale } from 'date-fns'
import { Check, FileText, LayoutGrid, Monitor, Pencil, PenTool, Plus, RefreshCw, Smartphone, Tablet, Trash2, X } from 'lucide-react'
import { getDateLocale } from '@craft-agent/shared/i18n'
import type { DesignProjectMeta } from '@craft-agent/shared/protocol'
import designContentManifest from '../../../resources/design/manifest.json'
import { Button } from '@/components/ui/button'
import {
  buildDesignPreviewUrl,
  createPendingDesignProjectRename,
  designChatSessionIdsAtom,
  designProjectsAtom,
  DESIGN_PROTOTYPE_DEVICE_WIDTHS,
  type DesignPrototypeDevice,
  getDesignPreviewFrameStyle,
  mostRecentDesignProject,
  pendingDesignProjectRenameAtom,
  resolveDesignProjectRenameCommit,
  seedDesignChatSessionIdAtom,
  sortDesignProjectsByUpdatedAtDesc,
} from '@/atoms/design'
import { DesignChatPanel } from '@/components/design/DesignChatPanel'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  BLANK_DESIGN_TEMPLATE_ID,
  NONE_DESIGN_SYSTEM_ID,
  buildBlankDesignProjectCreateInput,
  buildDesignProjectCreateInput,
  createInitialDesignCreationState,
  selectDesignCreationSystem,
  selectDesignCreationTemplate,
} from '@/lib/design-creation'
import { createDesignPreviewRefreshScheduler, resolveDesignProjectDir } from '@/lib/design-chat'
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

interface DesignTemplateOption {
  id: string
  name: string
  description: string
  kind?: string
}

interface DesignSystemOption {
  id: string
  name: string
  description: string
}

const DESIGN_TEMPLATE_OPTIONS = designContentManifest.templates as DesignTemplateOption[]
const DESIGN_SYSTEM_OPTIONS = designContentManifest.designSystems as DesignSystemOption[]

function DesignCreationDialog({
  creating,
  onCancel,
  onCreate,
}: {
  creating: boolean
  onCancel: () => void
  onCreate: (input: ReturnType<typeof buildDesignProjectCreateInput>) => Promise<void>
}) {
  const { t } = useTranslation()
  const [state, setState] = useState(createInitialDesignCreationState)

  const submit = async () => {
    await onCreate(buildDesignProjectCreateInput(t('design.defaultProjectName'), state))
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-create-title"
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-modal-small"
      >
        <div className="border-b border-border p-4">
          <h3 id="design-create-title" className="text-sm font-medium text-foreground">
            {t('design.createFlow.title')}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('design.createFlow.description')}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-2">
              <div>
                <h4 className="text-xs font-medium text-foreground">{t('design.createFlow.templateLabel')}</h4>
                <p className="text-[11px] text-muted-foreground">{t('design.createFlow.templateDescription')}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={state.templateId === BLANK_DESIGN_TEMPLATE_ID}
                  onClick={() => setState(prev => selectDesignCreationTemplate(prev, BLANK_DESIGN_TEMPLATE_ID))}
                  className={cn(
                    'flex min-h-24 gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-foreground/20',
                    state.templateId === BLANK_DESIGN_TEMPLATE_ID && 'border-primary/60 bg-primary/5',
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <FileText className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{t('design.createFlow.blankTemplate')}</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">{t('design.createFlow.blankTemplateDescription')}</div>
                  </div>
                </button>
                {DESIGN_TEMPLATE_OPTIONS.map(template => (
                  <button
                    key={template.id}
                    type="button"
                    aria-pressed={state.templateId === template.id}
                    onClick={() => setState(prev => selectDesignCreationTemplate(prev, template.id))}
                    className={cn(
                      'flex min-h-24 gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-foreground/20',
                      state.templateId === template.id && 'border-primary/60 bg-primary/5',
                    )}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <PenTool className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground" title={template.name}>{template.name}</div>
                      <div className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{template.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <section className="flex flex-col gap-2">
              <div>
                <h4 className="text-xs font-medium text-foreground">{t('design.createFlow.designSystemLabel')}</h4>
                <p className="text-[11px] text-muted-foreground">{t('design.createFlow.designSystemDescription')}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={state.designSystemId === NONE_DESIGN_SYSTEM_ID}
                  onClick={() => setState(prev => selectDesignCreationSystem(prev, NONE_DESIGN_SYSTEM_ID))}
                  className={cn(
                    'rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-foreground/20',
                    state.designSystemId === NONE_DESIGN_SYSTEM_ID && 'border-primary/60 bg-primary/5',
                  )}
                >
                  <div className="text-sm font-medium text-foreground">{t('design.createFlow.noDesignSystem')}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t('design.createFlow.noDesignSystemDescription')}</div>
                </button>
                {DESIGN_SYSTEM_OPTIONS.map(system => (
                  <button
                    key={system.id}
                    type="button"
                    aria-pressed={state.designSystemId === system.id}
                    onClick={() => setState(prev => selectDesignCreationSystem(prev, system.id))}
                    className={cn(
                      'rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-foreground/20',
                      state.designSystemId === system.id && 'border-primary/60 bg-primary/5',
                    )}
                  >
                    <div className="truncate text-sm font-medium text-foreground" title={system.name}>{system.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{system.description}</div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button variant="ghost" disabled={creating} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={creating} onClick={() => void submit()}>
            {t('design.createFlow.create')}
          </Button>
        </div>
      </div>
    </div>
  )
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
  const setSessionIds = useSetAtom(designChatSessionIdsAtom)
  const [deleteTarget, setDeleteTarget] = useState<DesignProjectMeta | null>(null)
  const [createFlowOpen, setCreateFlowOpen] = useState(false)
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

  const handleCreate = async (input: ReturnType<typeof buildDesignProjectCreateInput>) => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      const project = await window.electronAPI.designProjectCreate(workspaceId, input)
      setPendingRename(createPendingDesignProjectRename(project))
      navigate(routes.view.design(project.id))
      onOpenProject?.()
      setCreateFlowOpen(false)
    } catch (err) {
      toast.error(t('design.error.create'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  const handleCreateBlank = () => {
    void handleCreate(buildBlankDesignProjectCreateInput(t('design.defaultProjectName')))
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const targetId = deleteTarget.id
    const targetSessionId = deleteTarget.sessionId
    const remaining = sortedProjects.filter((project) => project.id !== targetId)
    setDeleteTarget(null)
    try {
      if (targetSessionId) {
        try {
          await window.electronAPI.deleteSession(targetSessionId)
        } catch (sessionErr) {
          console.warn('[Design] Failed to delete hidden chat session for project:', sessionErr)
        }
      }
      await window.electronAPI.designProjectDelete(workspaceId, targetId)
      setSessionIds((prev) => {
        const next = { ...prev }
        delete next[targetId]
        return next
      })
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
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" disabled={creating} onClick={() => setCreateFlowOpen(true)}>
            {t('design.gallery.create')}
          </Button>
          <Button size="sm" disabled={creating} onClick={handleCreateBlank}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('design.gallery.createBlank')}
          </Button>
        </div>
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
      {createFlowOpen && (
        <DesignCreationDialog
          creating={creating}
          onCancel={() => setCreateFlowOpen(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}

function DesignEmptyState({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const setPendingRename = useSetAtom(pendingDesignProjectRenameAtom)
  const [createFlowOpen, setCreateFlowOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false)

  const handleCreate = async (input: ReturnType<typeof buildDesignProjectCreateInput>) => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      const project = await window.electronAPI.designProjectCreate(workspaceId, input)
      setPendingRename(createPendingDesignProjectRename(project))
      navigate(routes.view.design(project.id))
      setCreateFlowOpen(false)
    } catch (err) {
      toast.error(t('design.error.create'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  const handleCreateBlank = () => {
    void handleCreate(buildBlankDesignProjectCreateInput(t('design.defaultProjectName')))
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
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={creating} onClick={handleCreateBlank}>
          {t('design.createFirst.button')}
        </Button>
        <Button size="sm" variant="ghost" disabled={creating} onClick={() => setCreateFlowOpen(true)}>
          {t('design.createFirst.chooseStarter')}
        </Button>
      </div>
      {createFlowOpen && (
        <DesignCreationDialog
          creating={creating}
          onCancel={() => setCreateFlowOpen(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}

const DESIGN_DEVICE_OPTIONS: Array<{ id: DesignPrototypeDevice; icon: typeof Monitor }> = [
  { id: 'desktop', icon: Monitor },
  { id: 'tablet', icon: Tablet },
  { id: 'mobile', icon: Smartphone },
]

export function DesignPreviewStage({
  workspaceId,
  project,
  reloadToken,
  onRefresh,
}: {
  workspaceId: string
  project: DesignProjectMeta
  reloadToken: number
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const [device, setDevice] = useState<DesignPrototypeDevice>('desktop')
  const previewUrl = useMemo(
    () => buildDesignPreviewUrl(workspaceId, project.id, project.entryFile, reloadToken),
    [workspaceId, project.id, project.entryFile, reloadToken],
  )
  const frameStyle = useMemo(
    () => getDesignPreviewFrameStyle(project.kind, device),
    [project.kind, device],
  )
  const isDeck = project.kind === 'deck'
  const isPrototype = project.kind === 'prototype'

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-muted/20">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{t('design.preview.title')}</div>
          <div className="truncate text-[11px] text-muted-foreground">{project.entryFile}</div>
        </div>
        <div className="flex items-center gap-2">
          {isPrototype && (
            <div
              role="group"
              aria-label={t('design.preview.deviceWidth')}
              className="flex items-center rounded-lg border border-border bg-card p-0.5"
            >
              {DESIGN_DEVICE_OPTIONS.map((option) => {
                const Icon = option.icon
                const selected = option.id === device
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    title={t(`design.preview.device.${option.id}`)}
                    onClick={() => setDevice(option.id)}
                    className={cn(
                      'flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors',
                      selected && 'bg-primary/10 text-primary',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span className="hidden sm:inline">{t(`design.preview.device.${option.id}`)}</span>
                  </button>
                )
              })}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={onRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t('design.preview.refresh')}
          </Button>
        </div>
      </div>
      <div className={cn(
        'flex min-h-0 flex-1 items-center justify-center overflow-auto p-6',
        isDeck ? 'bg-zinc-950' : 'bg-muted/30',
      )}>
        <div
          className={cn(
            'relative overflow-hidden border border-border bg-background shadow-modal-small transition-[max-width,width] duration-150',
            isDeck ? 'max-h-full rounded-xl' : 'h-full max-h-full rounded-2xl',
            isPrototype && 'mx-auto',
            project.kind === 'doc' && 'shadow-middle',
            project.kind === 'image' && 'bg-card',
          )}
          style={frameStyle}
          data-design-preview-kind={project.kind}
          data-design-preview-device={isPrototype ? device : undefined}
          data-design-preview-device-width={isPrototype ? DESIGN_PROTOTYPE_DEVICE_WIDTHS[device] : undefined}
        >
          <iframe
            key={`${project.id}:${project.entryFile}`}
            title={t('design.preview.iframeTitle', { name: project.name })}
            src={previewUrl}
            sandbox="allow-scripts allow-same-origin"
            className="h-full w-full border-0 bg-white"
          />
        </div>
      </div>
    </section>
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
  const [pendingRename, setPendingRename] = useAtom(pendingDesignProjectRenameAtom)
  const seedDesignChatSessionId = useSetAtom(seedDesignChatSessionIdAtom)
  const refreshProjects = useRefreshDesignProjects(workspaceId)
  const activeWorkspace = useActiveWorkspace()
  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  )
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [previewReloadToken, setPreviewReloadToken] = useState(0)
  const renaming = pendingRename?.projectId === projectId
  const projectDir = useMemo(
    () => activeWorkspace?.rootPath ? resolveDesignProjectDir(activeWorkspace.rootPath, projectId) : null,
    [activeWorkspace?.rootPath, projectId],
  )
  const refreshPreview = useCallback(() => {
    setPreviewReloadToken((value) => value + 1)
  }, [])
  const previewRefreshScheduler = useMemo(
    () => createDesignPreviewRefreshScheduler({
      delayMs: 400,
      refresh: refreshPreview,
    }),
    [refreshPreview],
  )

  useEffect(() => {
    if (currentProject) {
      seedDesignChatSessionId({ projectId: currentProject.id, sessionId: currentProject.sessionId })
    }
  }, [currentProject, seedDesignChatSessionId])

  useEffect(() => () => previewRefreshScheduler.cancel(), [previewRefreshScheduler])

  const commitRename = async () => {
    if (!currentProject) return
    const commit = resolveDesignProjectRenameCommit(pendingRename, currentProject)
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
        console.error('[Design] Failed to reconcile projects after project rename error:', refreshErr)
      }
    }
  }

  return (
    <div key={projectId} className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/60 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 gap-2"
            onClick={() => {
              if (!renaming) setGalleryOpen(true)
            }}
            title={t('design.toolbar.openGallery')}
          >
            <LayoutGrid className="h-3.5 w-3.5 shrink-0 opacity-70" />
            {renaming && currentProject ? (
              <input
                autoFocus
                value={pendingRename.draft}
                placeholder={t('design.gallery.renamePlaceholder')}
                onChange={(event) => setPendingRename({ projectId, draft: event.target.value })}
                onFocus={(event) => event.target.select()}
                onClick={(event) => event.stopPropagation()}
                onBlur={() => void commitRename()}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void commitRename()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setPendingRename(null)
                  }
                }}
                className="min-w-0 rounded-[5px] bg-foreground/5 px-2 py-1 text-sm text-foreground outline-none"
              />
            ) : (
              <span className="truncate font-medium" title={currentProject?.name ?? undefined}>
                {currentProject?.name ?? t('appMode.design')}
              </span>
            )}
          </Button>
          {currentProject && !renaming && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title={t('common.rename')}
              onClick={() => setPendingRename(createPendingDesignProjectRename(currentProject))}
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </div>
      {currentProject ? (
        <div className="flex min-h-0 flex-1">
          <DesignPreviewStage
            workspaceId={workspaceId}
            project={currentProject}
            reloadToken={previewReloadToken}
            onRefresh={refreshPreview}
          />
          <DesignChatPanel
            workspaceId={workspaceId}
            projectId={currentProject.id}
            projectDir={projectDir}
            persistedSessionId={currentProject.sessionId}
            onProjectFileWrite={previewRefreshScheduler.schedule}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-6 text-xs text-muted-foreground">
          {t('design.project.loading')}
        </div>
      )}
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
