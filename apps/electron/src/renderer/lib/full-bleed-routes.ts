import {
  parseRouteToNavigationState,
} from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'
import {
  isCanvasNavigation,
  isDesignNavigation,
  isGameStudioNavigation,
} from '../../shared/types'

export function isFullBleedRoute(route: ViewRoute | null): boolean {
  if (!route) return false
  const navState = parseRouteToNavigationState(route)
  return Boolean(
    navState &&
      (isCanvasNavigation(navState) || isGameStudioNavigation(navState) || isDesignNavigation(navState)),
  )
}

export function resolvePanelChromeHidden(
  parentHidden: boolean,
  focusedRoute: ViewRoute | null,
): boolean {
  return parentHidden || isFullBleedRoute(focusedRoute)
}
