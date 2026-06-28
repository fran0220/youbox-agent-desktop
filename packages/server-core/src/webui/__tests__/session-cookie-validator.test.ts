import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client'
import { createSessionTokenFromGateway } from '../auth'
import { createGatewaySessionCookieValidator } from '../session-cookie-validator'

const SECRET = 'test-jwt-signing-secret'
const GATEWAY_TOKEN = 'c'.repeat(64)

describe('createGatewaySessionCookieValidator', () => {
  beforeEach(() => {
    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/users/me') && init?.method === 'GET') {
        const auth = init.headers instanceof Headers
          ? init.headers.get('Authorization')
          : (init.headers as Record<string, string> | undefined)?.Authorization
        if (auth === `Bearer ${GATEWAY_TOKEN}`) {
          return new Response(
            JSON.stringify({ id: 'user-1', name: 'octest', email: 'a@b.c', role: 'admin' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify({ error: 'invalid session' }), { status: 401 })
      }
      return new Response('not found', { status: 404 })
    })
  })

  afterEach(() => {
    GatewayClient.setFetchForTests(undefined)
  })

  it('accepts cookie when gateway /users/me succeeds', async () => {
    const jwt = await createSessionTokenFromGateway('user-1', GATEWAY_TOKEN, SECRET)
    const cookie = `craft_session=${jwt}`
    const validate = createGatewaySessionCookieValidator(SECRET, 'http://127.0.0.1:8847')
    expect(await validate(cookie)).toBe(true)
  })

  it('rejects cookie when gateway returns 401', async () => {
    const jwt = await createSessionTokenFromGateway('user-1', 'd'.repeat(64), SECRET)
    const cookie = `craft_session=${jwt}`
    const validate = createGatewaySessionCookieValidator(SECRET, 'http://127.0.0.1:8847')
    expect(await validate(cookie)).toBe(false)
  })

  it('rejects missing or invalid JWT cookie', async () => {
    const validate = createGatewaySessionCookieValidator(SECRET, 'http://127.0.0.1:8847')
    expect(await validate(null)).toBe(false)
    expect(await validate('craft_session=not-a-jwt')).toBe(false)
  })
})
