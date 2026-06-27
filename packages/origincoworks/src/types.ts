/**
 * Wire types mirroring the Go gateway JSON contracts (auth + users/me).
 * @see research/gateway-api.md
 */

export type GatewayUserRole = string;

/** User object returned by login and GET /api/users/me */
export interface GatewayUser {
  id: string;
  name: string;
  email: string;
  role: GatewayUserRole;
}

/** POST /api/auth/login success body */
export interface LoginResponse {
  token: string;
  user: GatewayUser;
}

/** GET /api/users/me success body (same fields as user, no wrapper) */
export type MeResponse = GatewayUser;

const TOKEN_HEX_LEN = 64;

export function isGatewayUser(value: unknown): value is GatewayUser {
  if (!value || typeof value !== 'object') return false;
  const u = value as Record<string, unknown>;
  return (
    typeof u.id === 'string' &&
    typeof u.name === 'string' &&
    u.name.length > 0 &&
    typeof u.email === 'string' &&
    typeof u.role === 'string'
  );
}

export function assertLoginResponse(value: unknown): asserts value is LoginResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('login response must be an object');
  }
  const o = value as Record<string, unknown>;
  if (typeof o.token !== 'string' || !/^[0-9a-f]{64}$/i.test(o.token)) {
    throw new Error(`login token must be a ${TOKEN_HEX_LEN}-character hex string`);
  }
  if (!isGatewayUser(o.user)) {
    throw new Error('login response user must include id, name, email, role');
  }
}

export function assertGatewayUser(value: unknown): asserts value is GatewayUser {
  if (!isGatewayUser(value)) {
    throw new Error('response must be a gateway user with id, name, email, role');
  }
}

/** Placeholder for future GET /api/desktop/config (M2+); shape documented in gateway-api.md */
export interface DesktopConfig {
  primary_model?: string;
  primary_provider?: string;
}
