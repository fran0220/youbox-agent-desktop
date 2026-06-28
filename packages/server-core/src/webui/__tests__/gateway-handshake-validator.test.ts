import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client'
import {
  createCompoundHandshakeTokenValidator,
  createGatewayHandshakeTokenValidator,
  isGatewaySessionTokenShape,
} from '../gateway-handshake-validator'

const GATEWAY_TOKEN = 'e'.repeat(64)
const SERVER_TOKEN = 'server-local-token-32chars-min!!'

describe('gateway-handshake-validator', () => {
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

  it('isGatewaySessionTokenShape accepts 64-hex only', () => {
    expect(isGatewaySessionTokenShape(GATEWAY_TOKEN)).toBe(true)
    expect(isGatewaySessionTokenShape('short')).toBe(false)
    expect(isGatewaySessionTokenShape(SERVER_TOKEN)).toBe(false)
  })

  it('createGatewayHandshakeTokenValidator accepts valid gateway token', async () => {
    const validate = createGatewayHandshakeTokenValidator('http://127.0.0.1:8847')
    expect(await validate(GATEWAY_TOKEN)).toBe(true)
    expect(await validate('f'.repeat(64))).toBe(false)
  })

  it('createCompoundHandshakeTokenValidator accepts server token or gateway token', async () => {
    const validate = createCompoundHandshakeTokenValidator(SERVER_TOKEN, 'http://127.0.0.1:8847')
    expect(await validate(SERVER_TOKEN)).toBe(true)
    expect(await validate(GATEWAY_TOKEN)).toBe(true)
    expect(await validate('bad-token')).toBe(false)
  })
})
