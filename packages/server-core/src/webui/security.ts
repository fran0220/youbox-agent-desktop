/**
 * CSRF / Origin checks for state-changing WebUI HTTP routes.
 * Complements SameSite=Strict on the session cookie.
 */

function requestOrigin(req: Request): string {
  return new URL(req.url).origin
}

function originFromReferer(referer: string | null): string | null {
  if (!referer) return null
  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}

/**
 * Returns a 403 Response when the request Origin/Referer does not match the request URL,
 * or null when the request is allowed.
 */
export function assertSameOriginForStateChangingRequest(req: Request): Response | null {
  const method = req.method.toUpperCase()
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE' && method !== 'PATCH') {
    return null
  }

  const expected = requestOrigin(req)
  const origin = req.headers.get('origin')?.trim()

  if (origin) {
    if (origin !== expected) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    return null
  }

  const refererOrigin = originFromReferer(req.headers.get('referer'))
  if (refererOrigin) {
    if (refererOrigin !== expected) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    return null
  }

  const secFetchSite = req.headers.get('sec-fetch-site')?.toLowerCase()
  if (secFetchSite === 'cross-site') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // No Origin/Referer (curl, Bun test fetch, same-origin programmatic clients)
  return null
}
