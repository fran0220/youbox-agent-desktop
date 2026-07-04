import {
  parseRouteToNavigationState,
} from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'
import { isStudioNavigation } from '../../shared/types'

export function isFullBleedRoute(route: ViewRoute | null): boolean {
  if (!route) return false
  const navState = parseRouteToNavigationState(route)
  return Boolean(navState && isStudioNavigation(navState) && navState.details)
}

export function resolvePanelChromeHidden(
  parentHidden: boolean,
  focusedRoute: ViewRoute | null,
): boolean {
  return parentHidden || isFullBleedRoute(focusedRoute)
}
