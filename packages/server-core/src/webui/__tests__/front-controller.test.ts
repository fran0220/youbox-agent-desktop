import { describe, expect, it } from 'bun:test'
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

describe('createFrontControllerHandler /api/config wsUrl', () => {
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
})
