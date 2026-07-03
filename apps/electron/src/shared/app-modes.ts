/**
 * App Modes Registry
 *
 * Registry of top-level application modes (work | canvas | gamestudio | design). The current mode is
 * DERIVED from navigation state — there is no separate mode state machine.
 * Switching mode means navigating to that mode's default route.
 *
 * This module is dependency-light so both main/shared and renderer code can
 * import it. Icons are exported as lucide icon identifiers (`iconId`); the
 * renderer maps them to lucide-react components.
 */

import type { NavigationState } from './types'
import { isCanvasNavigation, isDesignNavigation, isGameStudioNavigation } from './types'
import { routes, type ViewRoute } from './routes'

export type AppModeId = 'work' | 'canvas' | 'gamestudio' | 'design'

/** Lucide icon identifier — mapped to a lucide-react component in the renderer. */
export type AppModeIconId = 'briefcase' | 'palette' | 'gamepad-2' | 'pen-tool'

export interface AppMode {
  id: AppModeId
  /** i18n key for the mode label (locale strings live in packages/shared/src/i18n/locales). */
  labelKey: string
  iconId: AppModeIconId
  /** Route to navigate to when switching into this mode. */
  defaultRoute: () => ViewRoute
  /** Whether the given navigation state belongs to this mode. */
  matches: (navState: NavigationState) => boolean
}

export const APP_MODES: readonly AppMode[] = [
  {
    id: 'work',
    labelKey: 'appMode.work',
    iconId: 'briefcase',
    defaultRoute: () => routes.view.allSessions(),
    matches: (navState) =>
      !isCanvasNavigation(navState) && !isGameStudioNavigation(navState) && !isDesignNavigation(navState),
  },
  {
    id: 'canvas',
    labelKey: 'appMode.canvas',
    iconId: 'palette',
    defaultRoute: () => routes.view.canvas(),
    matches: (navState) => isCanvasNavigation(navState),
  },
  {
    id: 'gamestudio',
    labelKey: 'appMode.gamestudio',
    iconId: 'gamepad-2',
    defaultRoute: () => routes.view.gamestudio(),
    matches: (navState) => isGameStudioNavigation(navState),
  },
  {
    id: 'design',
    labelKey: 'appMode.design',
    iconId: 'pen-tool',
    defaultRoute: () => routes.view.design(),
    matches: (navState) => isDesignNavigation(navState),
  },
]

export const DEFAULT_APP_MODE_ID: AppModeId = 'work'

export function getAppMode(id: AppModeId): AppMode {
  const mode = APP_MODES.find((m) => m.id === id)
  if (!mode) throw new Error(`Unknown app mode: ${id}`)
  return mode
}

export function getAppModeForNavigation(navState: NavigationState): AppMode {
  return APP_MODES.find((mode) => mode.matches(navState)) ?? getAppMode(DEFAULT_APP_MODE_ID)
}
