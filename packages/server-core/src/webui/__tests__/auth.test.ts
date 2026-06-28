import { afterEach, describe, it, expect } from 'bun:test'
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client'
import {
  buildSessionCookie,
  createSessionTokenFromGateway,
  verifyJwt,
  extractSessionCookie,
  resolveWebuiSessionFromCookie,
} from '../auth'

const SECRET = 'test-jwt-signing-secret'
const GATEWAY_TOKEN = 'a'.repeat(64)

describe('webui auth gateway session', () => {
  it('issues cookie JWT bound to gateway user id, not webui', async () => {
    const jwt = await createSessionTokenFromGateway('user-42', GATEWAY_TOKEN, SECRET)
    const payload = await verifyJwt(jwt, SECRET)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user-42')
    expect(payload!.sub).not.toBe('webui')
    expect(payload!.userId).toBe('user-42')
    expect(payload!.gatewayToken).toBe(GATEWAY_TOKEN)
  })

  it('buildSessionCookie sets HttpOnly, SameSite=Strict, and optional Secure', () => {
    const cookie = buildSessionCookie('jwt-value', false)
    expect(cookie).toContain('craft_session=jwt-value')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).not.toContain('Secure')

    const secureCookie = buildSessionCookie('jwt-value', true)
    expect(secureCookie).toContain('Secure')
  })

  it('distinct users get distinct JWT subs', async () => {
    const a = await createSessionTokenFromGateway('user-a', GATEWAY_TOKEN, SECRET)
    const b = await createSessionTokenFromGateway('user-b', 'b'.repeat(64), SECRET)
    const pa = await verifyJwt(a, SECRET)
    const pb = await verifyJwt(b, SECRET)
    expect(pa!.sub).toBe('user-a')
    expect(pb!.sub).toBe('user-b')
    expect(pa!.sub).not.toBe(pb!.sub)
  })

  it('extractSessionCookie parses craft_session from header', () => {
    expect(extractSessionCookie('craft_session=abc; other=1')).toBe('abc')
    expect(extractSessionCookie(null)).toBeNull()
  })

  describe('resolveWebuiSessionFromCookie', () => {
    afterEach(() => {
      GatewayClient.setFetchForTests(undefined)
    })

    it('returns payload when gateway /users/me succeeds', async () => {
      const token = 'e'.repeat(64)
      GatewayClient.setFetchForTests(async (input, init) => {
        const url = String(input)
        if (url.endsWith('/api/users/me') && init?.method === 'GET') {
          return new Response(
            JSON.stringify({ id: 'user-1', name: 'octest', email: 'a@b.c', role: 'admin' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('not found', { status: 404 })
      })
      const jwt = await createSessionTokenFromGateway('user-1', token, SECRET)
      const cookie = `craft_session=${jwt}`
      const session = await resolveWebuiSessionFromCookie(cookie, SECRET, 'http://127.0.0.1:8847')
      expect(session?.userId).toBe('user-1')
      expect(session?.gatewayToken).toBe(token)
    })

    it('returns null when gateway session was revoked (401)', async () => {
      const token = 'f'.repeat(64)
      GatewayClient.setFetchForTests(async (input, init) => {
        const url = String(input)
        if (url.endsWith('/api/users/me')) {
          return new Response(JSON.stringify({ error: 'invalid session' }), { status: 401 })
        }
        return new Response('not found', { status: 404 })
      })
      const jwt = await createSessionTokenFromGateway('user-1', token, SECRET)
      const cookie = `craft_session=${jwt}`
      const session = await resolveWebuiSessionFromCookie(cookie, SECRET, 'http://127.0.0.1:8847')
      expect(session).toBeNull()
    })
  })
})
