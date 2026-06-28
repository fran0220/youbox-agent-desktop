import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client'
import { createSessionTokenFromGateway } from '../auth'
import { createFrontControllerHandler } from '../front-controller'
import type { UserBackendPool } from '../user-backend-pool'

const SECRET = 'test-jwt-signing-secret-for-front-controller'
const GATEWAY_TOKEN = 'c'.repeat(64)

function mockPool(backendPort: number): UserBackendPool {
  return {
    ensureBackend: async () => ({
      userId: 'user-1',
      port: backendPort,
      pid: 1,
      configDir: '/tmp',
      gatewayToken: GATEWAY_TOKEN,
      stop: async () => {},
    }),
    releaseBackend: async () => {},
    dispose: async () => {},
    getBackendForUser: () => null,
  } as unknown as UserBackendPool
}

async function sessionCookie(): Promise<string> {
  const jwt = await createSessionTokenFromGateway('user-1', GATEWAY_TOKEN, SECRET)
  return `craft_session=${jwt}`
}

function installGatewayMeOkMock(): void {
  GatewayClient.setFetchForTests(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/users/me') && init?.method === 'GET') {
      return new Response(
        JSON.stringify({ id: 'user-1', name: 'octest', email: 'a@b.c', role: 'admin' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.endsWith('/api/auth/logout') && init?.method === 'POST') {
      return new Response(null, { status: 204 })
    }
    return new Response('not found', { status: 404 })
  })
}

describe('createFrontControllerHandler /api/config wsUrl', () => {
  afterEach(() => {
    GatewayClient.setFetchForTests(undefined)
  })

  beforeEach(() => {
    installGatewayMeOkMock()
  })

  it('uses localhost in wsUrl when request Host is localhost', async () => {
    const handler = createFrontControllerHandler({
      webuiDir: '/tmp/webui',
      secret: SECRET,
      pool: mockPool(9107),
      listenPort: 9100,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    })

    const req = new Request('http://localhost:9100/api/config', {
      method: 'GET',
      headers: {
        Host: 'localhost:9100',
        cookie: await sessionCookie(),
      },
    })

    const res = await handler.fetch(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { wsUrl: string }
    expect(body.wsUrl).toBe('ws://localhost:9107')
  })

  it('uses 127.0.0.1 in wsUrl when request Host is 127.0.0.1', async () => {
    const handler = createFrontControllerHandler({
      webuiDir: '/tmp/webui',
      secret: SECRET,
      pool: mockPool(9108),
      listenPort: 9100,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    })

    const req = new Request('http://127.0.0.1:9100/api/config', {
      method: 'GET',
      headers: {
        Host: '127.0.0.1:9100',
        cookie: await sessionCookie(),
      },
    })

    const res = await handler.fetch(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { wsUrl: string }
    expect(body.wsUrl).toBe('ws://127.0.0.1:9108')
  })

  it('rejects replayed cookie on /api/config after logout revokes gateway session', async () => {
    let logoutCalled = false
    let gatewayRevoked = false
    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/users/me') && init?.method === 'GET') {
        if (!gatewayRevoked) {
          return new Response(
            JSON.stringify({ id: 'user-1', name: 'octest', email: 'a@b.c', role: 'admin' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify({ error: 'invalid session' }), { status: 401 })
      }
      if (url.endsWith('/api/auth/logout') && init?.method === 'POST') {
        logoutCalled = true
        gatewayRevoked = true
        return new Response(null, { status: 204 })
      }
      return new Response('not found', { status: 404 })
    })

    let releasedUserId: string | undefined
    const pool = {
      ensureBackend: async () => ({
        userId: 'user-1',
        port: 9107,
        pid: 1,
        configDir: '/tmp',
        gatewayToken: GATEWAY_TOKEN,
        stop: async () => {},
      }),
      releaseBackend: async (userId: string) => {
        releasedUserId = userId
        return undefined
      },
      dispose: async () => {},
      getBackendForUser: () => null,
    } as unknown as UserBackendPool

    const handler = createFrontControllerHandler({
      webuiDir: '/tmp/webui',
      secret: SECRET,
      pool,
      listenPort: 9100,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    })

    const cookie = await sessionCookie()
    const configBefore = await handler.fetch(
      new Request('http://127.0.0.1:9100/api/config', {
        method: 'GET',
        headers: { Host: '127.0.0.1:9100', cookie },
      }),
    )
    expect(configBefore.status).toBe(200)

    const logoutRes = await handler.fetch(
      new Request('http://127.0.0.1:9100/api/auth/logout', {
        method: 'POST',
        headers: { Host: '127.0.0.1:9100', cookie, Origin: 'http://127.0.0.1:9100' },
      }),
    )
    expect(logoutRes.status).toBe(204)
    expect(logoutCalled).toBe(true)
    expect(releasedUserId).toBe('user-1')

    const configAfter = await handler.fetch(
      new Request('http://127.0.0.1:9100/api/config', {
        method: 'GET',
        headers: { Host: '127.0.0.1:9100', cookie },
      }),
    )
    expect(configAfter.status).toBe(401)
  })
})
