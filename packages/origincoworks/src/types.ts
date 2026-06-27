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

/** One model row from GET /api/desktop/config `models[]`. */
export interface DesktopConfigModelEntry {
  id: string;
  provider: string;
  label: string;
  context_window?: number;
  max_tokens?: number;
  reasoning?: boolean;
  api_type?: string;
}

/** GET /api/desktop/config success body (LLM fields only). */
export interface DesktopConfigResponse {
  llm_proxy_url: string;
  llm_proxy_key: string;
  embedding_base_url?: string;
  embedding_api_key?: string;
  primary_model: string;
  primary_provider: string;
  models: DesktopConfigModelEntry[];
  tools_manifest?: unknown;
}

/** @deprecated Use DesktopConfigResponse */
export type DesktopConfig = DesktopConfigResponse;

function isDesktopConfigModelEntry(value: unknown): value is DesktopConfigModelEntry {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    typeof m.provider === 'string' &&
    typeof m.label === 'string'
  );
}

export function assertDesktopConfigResponse(value: unknown): asserts value is DesktopConfigResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('desktop config response must be an object');
  }
  const o = value as Record<string, unknown>;
  if (typeof o.llm_proxy_url !== 'string' || !o.llm_proxy_url.trim()) {
    throw new Error('desktop config missing llm_proxy_url');
  }
  if (typeof o.llm_proxy_key !== 'string' || !o.llm_proxy_key.trim()) {
    throw new Error('desktop config missing llm_proxy_key');
  }
  if (typeof o.primary_model !== 'string' || !o.primary_model.trim()) {
    throw new Error('desktop config missing primary_model');
  }
  if (typeof o.primary_provider !== 'string') {
    throw new Error('desktop config missing primary_provider');
  }
  if (!Array.isArray(o.models) || o.models.length === 0) {
    throw new Error('desktop config models must be a non-empty array');
  }
  for (const entry of o.models) {
    if (!isDesktopConfigModelEntry(entry)) {
      throw new Error('desktop config models entry must include id, provider, label');
    }
  }
}
