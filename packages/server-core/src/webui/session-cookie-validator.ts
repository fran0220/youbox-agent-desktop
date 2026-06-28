/**
 * WebSocket upgrade auth: session cookie must map to a live gateway user session.
 */
import { resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth'
import { resolveWebuiSessionFromCookie } from './auth'

export function createGatewaySessionCookieValidator(
  jwtSecret: string,
  gatewayBaseUrl?: string,
): (cookieHeader: string | null) => Promise<boolean> {
  const baseUrl = gatewayBaseUrl ?? resolveGatewayBaseUrl()

  return async (cookieHeader: string | null): Promise<boolean> => {
    const session = await resolveWebuiSessionFromCookie(cookieHeader, jwtSecret, baseUrl)
    return session !== null
  }
}
