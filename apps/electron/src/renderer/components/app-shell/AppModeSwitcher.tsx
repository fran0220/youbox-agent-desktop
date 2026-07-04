/**
 * AppModeSwitcher - Registry-driven top-level mode switcher for the TopBar
 *
 * Renders every entry of the `app-modes` registry (work | studio) as a
 * centered segmented control. The active mode is DERIVED from the current
 * navigation state via getAppModeForNavigation — there is no local mode state.
 * Clicking a mode navigates to that mode's default route, so back/forward
 * history works across mode switches for free.
 *
 * Degrades to a dropdown when the shell is compact or when the space
 * available for the centered segmented control is insufficient (measured
 * against a hidden copy so real label widths are respected in every locale).
 */

import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import * as Icons from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { navigate } from "@/lib/navigate"
import { useNavigationState } from "@/contexts/NavigationContext"
import {
  APP_MODES,
  getAppModeForNavigation,
  type AppMode,
  type AppModeIconId,
} from "../../../shared/app-modes"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"

/** Maps registry icon identifiers to lucide-react components (renderer-only concern). */
const MODE_ICONS: Record<AppModeIconId, LucideIcon> = {
  briefcase: Icons.Briefcase,
  sparkles: Icons.Sparkles,
}

/** Breathing room required around the segmented control before degrading to a dropdown. */
const SEGMENTED_FIT_MARGIN = 24

function AppModeSegments({
  activeModeId,
  onSelect,
  interactive = true,
}: {
  activeModeId: AppMode["id"]
  onSelect?: (mode: AppMode) => void
  /** false for the hidden measuring copy (non-focusable, no handlers) */
  interactive?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      role="radiogroup"
      aria-label={t("appMode.switcher")}
      className={cn(
        "flex items-center gap-0.5 rounded-lg bg-foreground/5 p-0.5",
        interactive && "titlebar-no-drag",
      )}
    >
      {APP_MODES.map((mode) => {
        const Icon = MODE_ICONS[mode.iconId]
        const isActive = mode.id === activeModeId
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={interactive ? undefined : -1}
            onClick={interactive ? () => onSelect?.(mode) : undefined}
            className={cn(
              "flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2.5 text-xs transition-colors duration-100",
              isActive
                ? "bg-background text-foreground shadow-minimal"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>{t(mode.labelKey)}</span>
          </button>
        )
      })}
    </div>
  )
}

function AppModeDropdown({
  activeMode,
  onSelect,
}: {
  activeMode: AppMode
  onSelect: (mode: AppMode) => void
}) {
  const { t } = useTranslation()
  const ActiveIcon = MODE_ICONS[activeMode.iconId]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("appMode.switcher")}
          className={cn(
            "titlebar-no-drag flex h-7 items-center gap-1 rounded-[6px] px-1.5",
            "hover:bg-foreground/5 focus:outline-none focus-visible:ring-0 transition-colors duration-100",
          )}
        >
          <ActiveIcon className="h-4 w-4 text-foreground/70" strokeWidth={1.5} />
          <Icons.ChevronDown className="h-3 w-3 text-foreground/50" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="center" minWidth="min-w-40">
        {APP_MODES.map((mode) => {
          const Icon = MODE_ICONS[mode.iconId]
          const isActive = mode.id === activeMode.id
          return (
            <StyledDropdownMenuItem key={mode.id} onClick={() => onSelect(mode)}>
              <Icon className="h-3.5 w-3.5" />
              <span className="flex-1">{t(mode.labelKey)}</span>
              {isActive && <Icons.Check className="h-3 w-3 text-muted-foreground" />}
            </StyledDropdownMenuItem>
          )
        })}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppModeSwitcher({ isCompact }: { isCompact?: boolean }) {
  const navState = useNavigationState()
  const activeMode = getAppModeForNavigation(navState)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [fitsSegmented, setFitsSegmented] = useState(true)

  const handleSelect = (mode: AppMode) => {
    if (mode.id === activeMode.id) return
    navigate(mode.defaultRoute())
  }

  useEffect(() => {
    if (isCompact) return
    const containerEl = containerRef.current
    const measureEl = measureRef.current
    if (!containerEl || !measureEl) return

    let frame = 0

    const updateFit = () => {
      const available = containerEl.getBoundingClientRect().width
      const needed = measureEl.getBoundingClientRect().width
      const next = available >= needed + SEGMENTED_FIT_MARGIN
      setFitsSegmented((prev) => (prev === next ? prev : next))
    }

    const schedule = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateFit)
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(containerEl)
    // Also observe the measuring copy so locale/label changes re-trigger the fit check
    observer.observe(measureEl)
    updateFit()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [isCompact])

  const useDropdown = isCompact || !fitsSegmented

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex items-center",
        isCompact ? "shrink-0" : "min-w-0 flex-1 justify-center",
      )}
    >
      {!isCompact && (
        // Hidden copy so fit is measured against the real segmented control width
        <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0">
          <AppModeSegments activeModeId={activeMode.id} interactive={false} />
        </div>
      )}
      {useDropdown ? (
        <AppModeDropdown activeMode={activeMode} onSelect={handleSelect} />
      ) : (
        <AppModeSegments activeModeId={activeMode.id} onSelect={handleSelect} />
      )}
    </div>
  )
}
