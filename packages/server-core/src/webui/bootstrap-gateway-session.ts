/**
 * Seed a per-user headless backend with the gateway session from WebUI front-controller login.
 */
import { persistGatewaySession } from '@craft-agent/origincoworks/auth'
import { syncGatewayStateAfterAuth } from '../handlers/rpc/gateway-post-auth-sync'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handlers/handler-deps'

const TOKEN_HEX = /^[0-9a-f]{64}$/i

export function readGatewayBootstrapTokenFromEnv(): string | null {
  const raw = process.env.CRAFT_GATEWAY_SESSION_TOKEN?.trim()
  if (!raw || !TOKEN_HEX.test(raw)) return null
  return raw
}

/**
 * When CRAFT_GATEWAY_SESSION_TOKEN is set (per-user backend spawned by the front controller),
 * persist gateway credentials and sync LLM config before sessions start.
 */
export async function bootstrapGatewaySessionIfConfigured(
  sessionManager: HandlerDeps['sessionManager'],
  deps: HandlerDeps,
  rpcServer?: RpcServer | null,
): Promise<void> {
  const token = readGatewayBootstrapTokenFromEnv()
  if (!token) return

  await persistGatewaySession(token)
  const result = await syncGatewayStateAfterAuth({
    sessionManager,
    deps,
    rpcServer: rpcServer ?? null,
  })
  if (!result.llm.success) {
    throw new Error(`Gateway LLM bootstrap failed: ${result.llm.error ?? 'unknown'}`)
  }
}
