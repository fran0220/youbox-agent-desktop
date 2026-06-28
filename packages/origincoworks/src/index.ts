export { GatewayClient, GatewayHttpError } from './gateway-client.ts';
export type {
  DesktopConfig,
  DesktopConfigModelEntry,
  DesktopConfigResponse,
  GatewayUser,
  GatewayUserRole,
  LoginResponse,
  MeResponse,
} from './types.ts';
export {
  assertDesktopConfigResponse,
  assertGatewayUser,
  assertLoginResponse,
  isGatewayUser,
} from './types.ts';
export { fetchDesktopConfig } from './desktop-config.ts';
export { mapGatewayModelsToCraft } from './model-config.ts';
export {
  ORIGINCOWORKS_GATEWAY_LLM_SLUG,
  applyGatewayLlmConfigFromSession,
  buildGatewayLlmConnectionFromDesktopConfig,
  isGatewayManagedLlmSlug,
} from './llm-config.ts';
export type { ApplyGatewayLlmConfigDeps } from './llm-config.ts';
export type { GatewayPolicySnapshot, GatewayPolicyFlags } from './policy.ts';
export {
  mapDesktopPolicyResponse,
  fetchDesktopPolicy,
  getCachedGatewayPolicy,
  clearGatewayPolicyCacheForTests,
  evaluateGatewayPolicy,
  isHighRiskBashCommand,
  shouldPromptHighRiskInAllowAll,
} from './policy.ts';
export {
  clearGatewaySession,
  getGatewaySessionState,
  getStoredGatewayToken,
  loginGateway,
  logoutGateway,
  persistGatewaySession,
  resolveGatewayBaseUrl,
  sanitizeGatewayLoginError,
  GATEWAY_SESSION_CREDENTIAL,
} from './auth.ts';
export type {
  GatewayLoginResult,
  GatewaySessionState,
  GatewaySessionUnauthenticatedReason,
} from './auth.ts';
