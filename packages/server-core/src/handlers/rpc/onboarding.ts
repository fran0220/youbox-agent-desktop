/**
 * Onboarding IPC handlers for Electron main process
 *
 * Handles workspace setup and configuration persistence.
 */
import { getAuthState, getSetupNeeds } from '@craft-agent/shared/auth'
import { setSetupDeferred } from '@craft-agent/shared/config'
import {
  cancelYouBoxAgentAuth,
  prepareMcpOAuth,
  prepareYouBoxAgentAuth,
  waitForYouBoxAgentAuth,
} from '@craft-agent/shared/auth'
import { validateMcpConnection } from '@craft-agent/shared/mcp'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

const YOUBOX_ONLY_AUTH_ERROR = 'YouBox Agent only supports YouBox sign-in.'

// ============================================
// IPC Handlers
// ============================================

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.onboarding.GET_AUTH_STATE,
  RPC_CHANNELS.onboarding.VALIDATE_MCP,
  RPC_CHANNELS.onboarding.START_MCP_OAUTH,
  RPC_CHANNELS.onboarding.START_YOUBOX_AUTH,
  RPC_CHANNELS.onboarding.WAIT_YOUBOX_AUTH,
  RPC_CHANNELS.onboarding.CANCEL_YOUBOX_AUTH,
  RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH,
  RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE,
  RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.DEFER_SETUP,
] as const

export function registerOnboardingHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // Get current auth state
  server.handle(RPC_CHANNELS.onboarding.GET_AUTH_STATE, async () => {
    const authState = await getAuthState()
    const setupNeeds = getSetupNeeds(authState)
    // Redact raw credentials — renderer only needs boolean flags (hasCredentials, setupNeeds)
    return {
      authState: {
        ...authState,
        billing: {
          ...authState.billing,
          apiKey: authState.billing.apiKey ? '••••' : null,
          claudeOAuthToken: authState.billing.claudeOAuthToken ? '••••' : null,
        },
      },
      setupNeeds,
    }
  })

  // Validate MCP connection
  server.handle(RPC_CHANNELS.onboarding.VALIDATE_MCP, async (_ctx, mcpUrl: string, accessToken?: string) => {
    try {
      const result = await validateMcpConnection({
        mcpUrl,
        mcpAccessToken: accessToken,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Prepare MCP server OAuth (server-side only — no browser open).
  // Returns authUrl for the client to open locally.
  // NOTE: Currently unused in renderer. If re-enabled, needs client-side
  // orchestration (callback server + browser open) like performOAuth().
  server.handle(RPC_CHANNELS.onboarding.START_MCP_OAUTH, async (_ctx, mcpUrl: string, callbackPort?: number) => {
    log.info('[Onboarding:Main] ONBOARDING_START_MCP_OAUTH received')
    try {
      if (!callbackPort) {
        throw new Error('callbackPort is required — client must run a local callback server')
      }
      const prepared = await prepareMcpOAuth(mcpUrl, { callbackPort })
      log.info('[Onboarding:Main] MCP OAuth prepared, returning authUrl to client')

      return {
        success: true,
        authUrl: prepared.authUrl,
        state: prepared.state,
        codeVerifier: prepared.codeVerifier,
        tokenEndpoint: prepared.tokenEndpoint,
        clientId: prepared.clientId,
        redirectUri: prepared.redirectUri,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding:Main] MCP OAuth prepare failed:', message)
      return { success: false, error: message }
    }
  })

  server.handle(RPC_CHANNELS.onboarding.START_YOUBOX_AUTH, async () => {
    try {
      log.info('[Onboarding] Preparing YouBox Agent sign-in flow...')
      return prepareYouBoxAgentAuth()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding] Prepare YouBox Agent sign-in error:', message)
      return { success: false, error: message }
    }
  })

  server.handle(RPC_CHANNELS.onboarding.WAIT_YOUBOX_AUTH, async () => {
    try {
      return await waitForYouBoxAgentAuth()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  server.handle(RPC_CHANNELS.onboarding.CANCEL_YOUBOX_AUTH, async () => {
    return cancelYouBoxAgentAuth()
  })

  // Legacy provider OAuth is intentionally disabled in the YouBox fork. Keep
  // these channels registered so older renderer/preload builds fail closed
  // instead of reaching Anthropic/Craft account flows.
  server.handle(RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH, async () => {
    return { success: false, error: YOUBOX_ONLY_AUTH_ERROR }
  })

  server.handle(RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE, async () => {
    return { success: false, error: YOUBOX_ONLY_AUTH_ERROR }
  })

  server.handle(RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE, async () => {
    return false
  })

  server.handle(RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE, async () => {
    return { success: true }
  })

  // User chose "Setup later" — persist so onboarding doesn't re-show on next launch
  server.handle(RPC_CHANNELS.onboarding.DEFER_SETUP, async () => {
    setSetupDeferred(true)
    log?.info('[Onboarding] User deferred setup')
    return { success: true }
  })
}
