export function sanitizeRestoredWindowSearch(
  restoreUrl: string,
  workspaceId: string,
  workspaceSlug: string | undefined,
  focused: boolean,
): URLSearchParams {
  const savedUrl = new URL(restoreUrl)
  const params = new URLSearchParams(savedUrl.search)
  params.set('workspaceId', workspaceId)
  if (workspaceSlug) {
    params.set('ws', workspaceSlug)
  }
  if (focused) {
    params.set('focused', 'true')
  } else {
    params.delete('focused')
  }
  return params
}

export function buildDevRestoredWindowUrl(
  restoreUrl: string,
  devServerUrl: string,
  workspaceId: string,
  workspaceSlug: string | undefined,
  focused: boolean,
): string {
  const savedUrl = new URL(restoreUrl)
  const devUrl = new URL(devServerUrl)
  devUrl.pathname = savedUrl.pathname
  devUrl.search = sanitizeRestoredWindowSearch(restoreUrl, workspaceId, workspaceSlug, focused).toString()
  return devUrl.toString()
}

export function buildRestoredWindowQuery(
  restoreUrl: string,
  workspaceId: string,
  workspaceSlug: string | undefined,
  focused: boolean,
): Record<string, string> {
  const query: Record<string, string> = {}
  sanitizeRestoredWindowSearch(restoreUrl, workspaceId, workspaceSlug, focused)
    .forEach((value, key) => { query[key] = value })
  return query
}
