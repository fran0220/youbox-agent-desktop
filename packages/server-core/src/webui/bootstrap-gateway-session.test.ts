import { afterEach, describe, expect, it } from 'bun:test'
import { readGatewayBootstrapTokenFromEnv } from './bootstrap-gateway-session'

describe('readGatewayBootstrapTokenFromEnv', () => {
  const prev = process.env.CRAFT_GATEWAY_SESSION_TOKEN

  afterEach(() => {
    if (prev === undefined) delete process.env.CRAFT_GATEWAY_SESSION_TOKEN
    else process.env.CRAFT_GATEWAY_SESSION_TOKEN = prev
  })

  it('returns null when unset or invalid', () => {
    delete process.env.CRAFT_GATEWAY_SESSION_TOKEN
    expect(readGatewayBootstrapTokenFromEnv()).toBeNull()
    process.env.CRAFT_GATEWAY_SESSION_TOKEN = 'not-hex'
    expect(readGatewayBootstrapTokenFromEnv()).toBeNull()
  })

  it('returns 64-hex token when valid', () => {
    const token = 'a'.repeat(64)
    process.env.CRAFT_GATEWAY_SESSION_TOKEN = token
    expect(readGatewayBootstrapTokenFromEnv()).toBe(token)
  })
})
