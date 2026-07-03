interface SemanticHistoryKeyInput {
  workspaceSlug: string | null
  panelRoutes: string[]
  focusedPanelIndex: number
  sidebarParam: string
}

interface InitialRestoreGateInput {
  isReady: boolean
  isSessionsReady: boolean
  workspaceId: string | null
  initialRouteRestored: boolean
}

interface UrlReplaceSyncGateInput {
  initialRouteRestored: boolean
  pushPending: boolean
}

interface InitialRestoreSearchInput {
  currentSearch: string
  savedWorkspaceSearch: string
}

/**
 * Builds a semantic history key used to dedupe pushState entries.
 *
 * Includes focused panel index so states with duplicate routes remain distinct
 * when focus moves between panels.
 */
export function buildSemanticHistoryKey({
  workspaceSlug,
  panelRoutes,
  focusedPanelIndex,
  sidebarParam,
}: SemanticHistoryKeyInput): string {
  return [
    workspaceSlug ?? '',
    panelRoutes.join('|'),
    String(focusedPanelIndex),
    sidebarParam,
  ].join('::')
}

/**
 * Returns whether the replaceState URL sync may rewrite the CURRENT history
 * entry.
 *
 * While a semantic pushState is pending (queued as a microtask after a panel
 * route/focus change), replacing must be skipped: React 18 flushes passive
 * effects synchronously for discrete events, before microtasks, so the
 * replace would stamp the NEXT state's URL onto the entry the user would
 * return to, making back a visual no-op and losing the previous state.
 */
export function canReplaceUrlForStateSync({
  initialRouteRestored,
  pushPending,
}: UrlReplaceSyncGateInput): boolean {
  return initialRouteRestored && !pushPending
}

/**
 * Returns whether initial route restoration is allowed to run.
 */
export function canRunInitialRestore({
  isReady,
  isSessionsReady,
  workspaceId,
  initialRouteRestored,
}: InitialRestoreGateInput): boolean {
  return isReady && isSessionsReady && !!workspaceId && !initialRouteRestored
}

/**
 * Chooses the search string to reconcile during app startup.
 *
 * A window restore URL from the main process is the freshest persisted state on
 * app restart. Workspace-scoped localStorage is only a fallback for launches
 * whose URL does not already carry a route/panel restore target.
 */
export function selectInitialRestoreSearch({
  currentSearch,
  savedWorkspaceSearch,
}: InitialRestoreSearchInput): string {
  const currentParams = new URLSearchParams(currentSearch)
  if (currentParams.get('route') || currentParams.get('panels')) {
    return currentSearch
  }

  return savedWorkspaceSearch || currentSearch
}
