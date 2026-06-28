import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client'
import { startWebuiHttpServer } from '../http-server'

const SECRET = 'test-server-secret'
const GATEWAY_TOKEN = 'a'.repeat(64)
const USERNAME = 'octest'
const PASSWORD = 'test-password'
const TEMP_DIRS: string[] = []
const SERVERS: Array<{ stop: () => void }> = []

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any

function createTestWebuiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-webui-test-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>')
  return dir
}

function installGatewayLoginMock(validPassword = PASSWORD) {
  GatewayClient.setFetchForTests(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/users/me') && init?.method === 'GET') {
      const auth = init.headers instanceof Headers
        ? init.headers.get('Authorization')
        : undefined
      if (auth === `Bearer ${GATEWAY_TOKEN}`) {
        return new Response(
          JSON.stringify({ id: 'user-1', name: USERNAME, email: 'octest@local.test', role: 'admin' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ error: 'invalid session' }), { status: 401 })
    }
    if (url.endsWith('/api/auth/login') && init?.method === 'POST') {
      const raw = typeof init.body === 'string' ? init.body : ''
      let parsed: { username?: string; password?: string } = {}
      try {
        parsed = JSON.parse(raw) as { username?: string; password?: string }
      } catch {
        return new Response(JSON.stringify({ error: 'invalid credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (parsed.username === USERNAME && parsed.password === validPassword) {
        return new Response(
          JSON.stringify({
            token: GATEWAY_TOKEN,
            user: { id: 'user-1', name: USERNAME, email: 'octest@local.test', role: 'admin' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ error: 'invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  })
}

async function createServer(overrides?: {
  secureCookies?: boolean
  publicWsUrl?: string
  wsProtocol?: 'ws' | 'wss'
  wsPort?: number
}) {
  const server = await startWebuiHttpServer({
    port: 0,
    webuiDir: createTestWebuiDir(),
    secret: SECRET,
    gatewayBaseUrl: 'http://127.0.0.1:8847',
    secureCookies: overrides?.secureCookies,
    publicWsUrl: overrides?.publicWsUrl,
    wsProtocol: overrides?.wsProtocol ?? 'wss',
    wsPort: overrides?.wsPort ?? 9100,
    getHealthCheck: () => ({ status: 'ok' }),
    logger,
  })

  SERVERS.push(server)

  return {
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
  }
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  expect(setCookie).toBeTruthy()
  return setCookie!.split(';')[0]!
}

beforeEach(() => {
  installGatewayLoginMock()
})

afterEach(() => {
  GatewayClient.setFetchForTests(undefined)
  while (SERVERS.length > 0) {
    SERVERS.pop()?.stop()
  }

  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('startWebuiHttpServer', () => {
  it('serves /login without authentication', async () => {
    const { baseUrl } = await createServer()
    const res = await fetch(`${baseUrl}/login`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('login')
  })

  it('redirects unauthenticated HTML requests to /login', async () => {
    const { baseUrl } = await createServer()
    const res = await fetch(`${baseUrl}/`, { redirect: 'manual', headers: { Accept: 'text/html' } })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
  })

  it('returns 401 for /api/config without session cookie', async () => {
    const { baseUrl } = await createServer()
    const res = await fetch(`${baseUrl}/api/config`)
    expect(res.status).toBe(401)
  })

  it('allows plain-http login even when the RPC transport is wss', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    })

    expect(authRes.status).toBe(200)
    const setCookie = authRes.headers.get('set-cookie')
    expect(setCookie).toContain('craft_session=')
    expect(setCookie).not.toContain('Secure')

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://127.0.0.1:9100',
    })
  })

  it('rejects invalid credentials', async () => {
    const { baseUrl } = await createServer()

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: 'wrong-password' }),
    })

    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
    const body = await res.json() as { error: string }
    expect(body.error).toBe('invalid credentials')
    expect(JSON.stringify(body)).not.toContain('wrong-password')
  })

  it('honors an explicit secure-cookie override', async () => {
    const { baseUrl } = await createServer({ secureCookies: true, wsProtocol: 'ws', wsPort: 9100 })

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('infers secure cookies from proxy https headers when no override is set', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('derives a browser-facing websocket URL from forwarded public host headers', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'craft.example.com:3100',
      },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'craft.example.com:3100',
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://craft.example.com:9100',
    })
  })

  it('rejects POST /api/auth with foreign Origin', async () => {
    const { baseUrl } = await createServer()

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    })

    expect(res.status).toBe(403)
  })

  it('POST /api/auth/refresh re-mints session cookie when gateway session is valid', async () => {
    const { baseUrl } = await createServer()

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    })
    const cookie = extractSessionCookie(authRes)

    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { cookie },
    })

    expect(refreshRes.status).toBe(200)
    const body = await refreshRes.json() as { ok: boolean; expiresIn: number }
    expect(body.ok).toBe(true)
    expect(body.expiresIn).toBeGreaterThan(0)
    expect(refreshRes.headers.get('set-cookie')).toContain('craft_session=')
  })

  it('returns an explicit public websocket URL override from /api/config', async () => {
    const { baseUrl } = await createServer({
      publicWsUrl: 'wss://craft.example.com/ws',
      wsProtocol: 'wss',
      wsPort: 9100,
    })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://craft.example.com/ws',
    })
  })
})
