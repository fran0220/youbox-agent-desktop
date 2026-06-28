/**
 * WebSocket upgrade auth: session cookie must map to a live gateway user session.
 */
import { GatewayClient, GatewayHttpError } from '@craft-agent/origincoworks/gateway-client'
import { resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth'
import { validateSession } from './auth'

export function createGatewaySessionCookieValidator(
  jwtSecret: string,
  gatewayBaseUrl?: string,
): (cookieHeader: string | null) => Promise<boolean> {
  const baseUrl = gatewayBaseUrl ?? resolveGatewayBaseUrl()

  return async (cookieHeader: string | null): Promise<boolean> => {
    const session = await validateSession(cookieHeader, jwtSecret)
    if (!session?.gatewayToken) {
      return false
    }

    const client = new GatewayClient(baseUrl, session.gatewayToken)
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
