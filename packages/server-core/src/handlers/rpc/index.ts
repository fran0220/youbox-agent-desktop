import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

import { registerAuthHandlers } from './auth'
import { registerAutomationsHandlers } from './automations'
import { registerCanvasHandlers } from './canvas'
import { registerCanvasAssetHandlers } from './canvas-asset'
import { registerCanvasImageHandlers } from './canvas-image'
import { registerDesignHandlers } from './design'
import { registerFilesHandlers } from './files'
import { registerGameStudioHandlers } from './gamestudio'
import { registerLabelsHandlers } from './labels'
import { registerLlmConnectionsHandlers } from './llm-connections'
import { registerOAuthHandlers } from './oauth'
import { registerResourcesHandlers } from './resources'
import { registerOnboardingHandlers } from './onboarding'
import { registerSessionsHandlers } from './sessions'
export { registerSessionsHandlers, cleanupSessionFileWatchForClient } from './sessions'
import { registerServerHandlers } from './server'
import type { ServerHandlerContext } from '../../bootstrap/headless-start'
export type { ServerHandlerContext } from '../../bootstrap/headless-start'
export { getHealthCheck } from './server'
import { registerSettingsHandlers } from './settings'
import { registerSkillsHandlers } from './skills'
import { registerSourcesHandlers } from './sources'
import { registerStatusesHandlers } from './statuses'
import { registerStudioHandlers } from './studio'
import { registerSystemCoreHandlers } from './system'
import { registerTransferHandlers } from './transfer'
import { registerWorkspaceCoreHandlers } from './workspace'
import { registerMessagingHandlers } from './messaging'
import { registerGatewayHandlers } from './gateway'

export function registerCoreRpcHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  serverCtx?: ServerHandlerContext,
): void {
  registerAuthHandlers(server, deps)
  registerGatewayHandlers(server, deps)
  registerAutomationsHandlers(server, deps)
  registerCanvasHandlers(server, deps)
  registerCanvasAssetHandlers(server, deps)
  registerCanvasImageHandlers(server, deps)
  registerDesignHandlers(server, deps)
  registerFilesHandlers(server, deps)
  registerGameStudioHandlers(server, deps)
  registerLabelsHandlers(server, deps)
  registerLlmConnectionsHandlers(server, deps)
  registerOAuthHandlers(server, deps)
  registerOnboardingHandlers(server, deps)
  registerResourcesHandlers(server, deps)
  registerSessionsHandlers(server, deps)
  if (serverCtx) registerServerHandlers(server, deps, serverCtx)
  registerSettingsHandlers(server, deps)
  registerSkillsHandlers(server, deps)
  registerSourcesHandlers(server, deps)
  registerStatusesHandlers(server, deps)
  registerStudioHandlers(server, deps)
  registerSystemCoreHandlers(server, deps)
  registerTransferHandlers(server)
  registerWorkspaceCoreHandlers(server, deps)
  registerMessagingHandlers(server, deps)
}
