/**
 * WebSocket handshake: accept per-process server token OR live gateway session token (64-hex).
 */
import { GatewayClient, GatewayHttpError } from '@craft-agent/origincoworks/gateway-client'
import { resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth'

const TOKEN_HEX = /^[0-9a-f]{64}$/i

export function isGatewaySessionTokenShape(token: string): boolean {
  return TOKEN_HEX.test(token.trim())
}

export function createGatewayHandshakeTokenValidator(
  gatewayBaseUrl?: string,
): (token: string) => Promise<boolean> {
  const baseUrl = gatewayBaseUrl ?? resolveGatewayBaseUrl()

  return async (token: string): Promise<boolean> => {
    const trimmed = token.trim()
    if (!isGatewaySessionTokenShape(trimmed)) {
      return false
    }
    const client = new GatewayClient(baseUrl, trimmed)
    try {
      await client.me()
      return true
    } catch (err) {
      if (err instanceof GatewayHttpError && (err.status === 401 || err.status === 403)) {
        return false
      }
      return false
    }
  }
}

export function createCompoundHandshakeTokenValidator(
  serverToken: string,
  gatewayBaseUrl?: string,
): (token: string) => Promise<boolean> {
  const validateGateway = createGatewayHandshakeTokenValidator(gatewayBaseUrl)

  return async (token: string): Promise<boolean> => {
    if (token === serverToken) {
      return true
    }
    return validateGateway(token)
  }
}
