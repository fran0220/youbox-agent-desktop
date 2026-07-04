import * as Icons from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { StudioRecentArtifact } from '@craft-agent/shared/protocol'
import { canvasDocsAtom } from '@/atoms/canvas'
import { designProjectsAtom } from '@/atoms/design'
import { gamestudioProjectsAtom } from '@/atoms/gamestudio'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { StudioKind } from '../../../shared/types'
import { isStudioNavigation, useNavigationState } from '@/contexts/NavigationContext'

const KIND_CONFIG: Record<StudioKind, { label: string; icon: Icons.LucideIcon }> = {
  canvas: { label: 'Canvas', icon: Icons.Palette },
  design: { label: 'Design', icon: Icons.PenTool },
  game: { label: 'Game', icon: Icons.Gamepad2 },
}

export function StudioNavigator({ workspaceId }: { workspaceId: string | null | undefined }) {
  const { t } = useTranslation()
  const navState = useNavigationState()
  const studioNav = isStudioNavigation(navState) ? navState : null
  const canvasDocs = useAtomValue(canvasDocsAtom)
  const designProjects = useAtomValue(designProjectsAtom)
  const gameProjects = useAtomValue(gamestudioProjectsAtom)
  const [recents, setRecents] = useState<StudioRecentArtifact[]>([])

  useEffect(() => {
    if (!workspaceId) {
      setRecents([])
      return
    }
    let disposed = false
    window.electronAPI.studioListRecents(workspaceId)
      .then((items) => { if (!disposed) setRecents(items.slice(0, 8)) })
      .catch(() => { if (!disposed) setRecents([]) })
    return () => { disposed = true }
  }, [workspaceId, canvasDocs, designProjects, gameProjects])

  const kindCounts: Record<StudioKind, number> = {
    canvas: canvasDocs?.length ?? 0,
    design: designProjects?.length ?? 0,
    game: gameProjects?.length ?? 0,
  }

  const rowClass = (active: boolean) => cn(
    'flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left text-[13px] transition-colors',
    active ? 'bg-foreground/10 text-foreground shadow-minimal' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
  )

  return (
    <div className="flex h-full flex-col select-none font-sans">
      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={() => navigate(routes.view.studio())}
          className={rowClass(!!studioNav && studioNav.kind === null)}
        >
          <Icons.Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
          <span className="min-w-0 flex-1 truncate">{t('appMode.studio')}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 mask-fade-bottom">
        <div className="grid gap-0.5">
          {(['canvas', 'design', 'game'] as const).map((kind) => {
            const config = KIND_CONFIG[kind]
            const Icon = config.icon
            const active = studioNav?.kind === kind && !studioNav.details
            return (
              <button
                key={kind}
                type="button"
                onClick={() => navigate(routes.view.studio(kind))}
                className={rowClass(active)}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
                <span className="min-w-0 flex-1 truncate">{config.label}</span>
                <span className="text-[11px] text-muted-foreground/70">{kindCounts[kind]}</span>
              </button>
            )
          })}
        </div>

        <div className="my-3 h-px bg-foreground/5" />
        <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
          Recent
        </div>
        <div className="grid gap-0.5">
          {recents.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">No Studio artifacts yet</div>
          ) : recents.map((item) => {
            const config = KIND_CONFIG[item.kind]
            const Icon = config.icon
            const active = studioNav?.kind === item.kind && studioNav.details?.artifactId === item.id
            return (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                onClick={() => navigate(routes.view.studio(item.kind, item.id))}
                className={rowClass(active)}
                title={item.name}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
