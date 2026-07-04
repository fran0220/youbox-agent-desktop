import * as Icons from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { APP_MODES, getAppModeForNavigation, type AppModeIconId } from '../../../shared/app-modes'
import { useNavigationState } from '@/contexts/NavigationContext'
import { navigate } from '@/lib/navigate'
import { cn } from '@/lib/utils'

const MODE_ICONS: Record<AppModeIconId, Icons.LucideIcon> = {
  briefcase: Icons.Briefcase,
  sparkles: Icons.Sparkles,
}

interface GlobalRailProps {
  isHidden: boolean
  isSettingsActive: boolean
  hasUnseenReleaseNotes: boolean
  onOpenSettings: () => void
  onOpenWhatsNew: () => void
}

export function GlobalRail({
  isHidden,
  isSettingsActive,
  hasUnseenReleaseNotes,
  onOpenSettings,
  onOpenWhatsNew,
}: GlobalRailProps) {
  const { t } = useTranslation()
  const navState = useNavigationState()
  const activeMode = getAppModeForNavigation(navState)

  if (isHidden) return null

  return (
    <aside
      aria-label="Global navigation"
      className="z-panel flex h-full w-[52px] shrink-0 flex-col items-center border-r border-border/50 bg-background/80 py-2"
    >
      <div className="flex flex-col items-center gap-1">
        {APP_MODES.map((mode) => {
          const Icon = MODE_ICONS[mode.iconId]
          const isActive = !isSettingsActive && activeMode.id === mode.id
          return (
            <button
              key={mode.id}
              type="button"
              aria-label={t(mode.labelKey)}
              aria-pressed={isActive}
              onClick={() => {
                if (activeMode.id !== mode.id || isSettingsActive) navigate(mode.defaultRoute())
              }}
              className={cn(
                'titlebar-no-drag flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary shadow-sm'
                  : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
              )}
              title={t(mode.labelKey)}
            >
              <Icon className="h-5 w-5" strokeWidth={1.6} />
            </button>
          )
        })}
      </div>

      <div className="mt-auto flex flex-col items-center gap-1">
        <button
          type="button"
          aria-label={t('sidebar.settings')}
          aria-pressed={isSettingsActive}
          onClick={onOpenSettings}
          className={cn(
            'titlebar-no-drag flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
            isSettingsActive
              ? 'bg-primary/10 text-primary shadow-sm'
              : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
          )}
          title={t('sidebar.settings')}
        >
          <Icons.Settings className="h-5 w-5" strokeWidth={1.6} />
        </button>
        <button
          type="button"
          aria-label={t('sidebar.whatsNew')}
          onClick={onOpenWhatsNew}
          className="titlebar-no-drag relative flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          title={t('sidebar.whatsNew')}
        >
          <Icons.Cake className="h-5 w-5" strokeWidth={1.6} />
          {hasUnseenReleaseNotes ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent" /> : null}
        </button>
      </div>
    </aside>
  )
}
