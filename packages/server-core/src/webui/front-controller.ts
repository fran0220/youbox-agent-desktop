import {
  createWebuiHandler,
  resolveWebSocketUrl,
  type WebuiHandler,
  type WebuiHandlerOptions,
} from './http-server'
import { resolveWebuiSessionFromCookie, revokeGatewaySessionForPayload } from './auth'
import type { UserBackendPool } from './user-backend-pool'

export interface FrontControllerOptions extends Omit<WebuiHandlerOptions, 'wsPort' | 'wsProtocol' | 'getHealthCheck'> {
  pool: UserBackendPool
  /** Front-controller listen port (9100). */
  listenPort: number
  getHealthCheck?: () => { status: string }
}

/**
 * HTTP-only front controller: gateway login on :9100, per-user backends on 9101+.
 * WebSocket clients connect to the per-user backend port returned by /api/config.
 */
export function createFrontControllerHandler(options: FrontControllerOptions): WebuiHandler {
  const {
    pool,
    listenPort,
    secret,
    getHealthCheck = () => ({ status: 'ok' }),
    ...handlerOpts
  } = options

  const loginHandler = createWebuiHandler({
    ...handlerOpts,
    secret,
    wsProtocol: 'ws',
    wsPort: listenPort,
    getHealthCheck,
  })

  async function proxyToBackend(
    req: Request,
    backendPort: number,
    sessionCookie: string,
  ): Promise<Response> {
    const url = new URL(req.url)
    const targetUrl = `http://127.0.0.1:${backendPort}${url.pathname}${url.search}`

    const headers = new Headers(req.headers)
    headers.set('cookie', sessionCookie)
    headers.delete('host')

    const init: RequestInit = {
      method: req.method,
      headers,
      redirect: 'manual',
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = await req.arrayBuffer()
    }

    const backendRes = await globalThis.fetch(targetUrl, init)
    return new Response(backendRes.body, {
      status: backendRes.status,
      statusText: backendRes.statusText,
      headers: backendRes.headers,
    })
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === '/health') {
      return Response.json(getHealthCheck(), { status: 200 })
    }

    const publicPaths = new Set(['/login', '/login/', '/favicon.ico'])
    const isLoginAsset = path.startsWith('/login-assets/')
    const isAuthApi = path === '/api/auth' && req.method === 'POST'

    if (publicPaths.has(path) || isLoginAsset || isAuthApi) {
      return loginHandler.fetch(req)
    }

    const cookieHeader = req.headers.get('cookie')
    const session = await resolveWebuiSessionFromCookie(cookieHeader, secret)
    if (!session?.userId || !session.gatewayToken) {
      if (path === '/api/auth/logout' && req.method === 'POST') {
        return loginHandler.fetch(req)
      }
      const accept = req.headers.get('accept') ?? ''
      if (accept.includes('text/html') || path === '/' || path === '') {
        return Response.redirect('/login', 302)
      }
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (path === '/api/auth/logout' && req.method === 'POST') {
      await revokeGatewaySessionForPayload(session)
      if (session.userId) {
        await pool.releaseBackend(session.userId)
      }
      return loginHandler.fetch(req)
    }

    if (path === '/api/auth/refresh' && req.method === 'POST') {
      return loginHandler.fetch(req)
    }

    let backend
    try {
      backend = await pool.ensureBackend(session.userId, session.gatewayToken)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return Response.json({ error: `Backend unavailable: ${msg}` }, { status: 503 })
    }

    if (path === '/api/config' && req.method === 'GET') {
      const wsUrl = resolveWebSocketUrl(req, {
        wsProtocol: 'ws',
        wsPort: backend.port,
      })
      return Response.json({ wsUrl })
    }

    if (path === '/api/config/workspaces' && req.method === 'GET') {
      return proxyToBackend(req, backend.port, cookieHeader ?? '')
    }

    const cookie = cookieHeader ?? ''
    return proxyToBackend(req, backend.port, cookie)
  }

  return {
    fetch,
    dispose: () => {
      loginHandler.dispose()
      void pool.dispose()
    },
    setOAuthCallbackDeps: (deps) => loginHandler.setOAuthCallbackDeps(deps),
  }
}
