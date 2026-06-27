export { GatewayClient, GatewayHttpError } from './gateway-client.ts';
export type {
  DesktopConfig,
  GatewayUser,
  GatewayUserRole,
  LoginResponse,
  MeResponse,
} from './types.ts';
export {
  assertGatewayUser,
  assertLoginResponse,
  isGatewayUser,
} from './types.ts';
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
