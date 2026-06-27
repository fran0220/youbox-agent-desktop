/**
 * Gateway login/session helpers — persists session token via Craft CredentialManager.
 */
import { getCredentialManager, type CredentialId } from '@craft-agent/shared/credentials';
import { GatewayClient, GatewayHttpError } from './gateway-client.ts';
import type { GatewayUser } from './types.ts';

export const GATEWAY_SESSION_CREDENTIAL: CredentialId = {
  type: 'gateway_session',
};

const TOKEN_HEX = /^[0-9a-f]{64}$/i;

export function resolveGatewayBaseUrl(): string {
  const fromEnv = process.env.ORIGINCOWORKS_GATEWAY_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return 'http://127.0.0.1:8847';
}

export function sanitizeGatewayLoginError(err: unknown): string {
  if (err instanceof GatewayHttpError) {
    if (err.status === 401) {
      return 'invalid credentials';
    }
    if (err.body && typeof err.body === 'object' && err.body !== null && 'error' in err.body) {
      const msg = String((err.body as { error: unknown }).error);
      if (msg && !msg.includes('password') && msg.length < 200) {
        return msg;
      }
    }
    return 'Sign in failed. Check your username and password.';
  }
  if (err instanceof Error && err.message && !err.message.includes('password')) {
    if (err.message.length < 200) return err.message;
  }
  return 'Sign in failed. Please try again.';
}

export async function getStoredGatewayToken(): Promise<string | null> {
  const manager = getCredentialManager();
  const stored = await manager.get(GATEWAY_SESSION_CREDENTIAL);
  const token = stored?.value?.trim();
  if (!token || !TOKEN_HEX.test(token)) {
    return null;
  }
  return token;
}

export async function clearGatewaySession(): Promise<void> {
  const manager = getCredentialManager();
  await manager.delete(GATEWAY_SESSION_CREDENTIAL);
}

export async function persistGatewaySession(token: string): Promise<void> {
  if (!TOKEN_HEX.test(token)) {
    throw new Error('gateway session token must be 64 hex characters');
  }
  const manager = getCredentialManager();
  await manager.set(GATEWAY_SESSION_CREDENTIAL, { value: token });
}

export type GatewaySessionUnauthenticatedReason = 'no_token' | 'invalid_token';

export type GatewaySessionState =
  | { authenticated: false; reason: GatewaySessionUnauthenticatedReason }
  | { authenticated: true; user: GatewayUser };

export async function getGatewaySessionState(baseUrl?: string): Promise<GatewaySessionState> {
  const token = await getStoredGatewayToken();
  if (!token) {
    return { authenticated: false, reason: 'no_token' };
  }
  const client = new GatewayClient(baseUrl ?? resolveGatewayBaseUrl(), token);
  try {
    const user = await client.me();
    return { authenticated: true, user };
  } catch (err) {
    if (err instanceof GatewayHttpError && (err.status === 401 || err.status === 403)) {
      await clearGatewaySession();
      return { authenticated: false, reason: 'invalid_token' };
    }
    throw err;
  }
}

export async function logoutGateway(baseUrl?: string): Promise<void> {
  const token = await getStoredGatewayToken();
  const resolvedBase = baseUrl ?? resolveGatewayBaseUrl();
  if (token) {
    const client = new GatewayClient(resolvedBase, token);
    try {
      await client.logout();
    } catch (err) {
      if (!(err instanceof GatewayHttpError)) {
        throw err;
      }
      // Best-effort revoke — still clear local session if server already invalidated
    }
  }
  await clearGatewaySession();
}

export type GatewayLoginResult =
  | { success: true; user: GatewayUser }
  | { success: false; error: string };

export async function loginGateway(
  username: string,
  password: string,
  baseUrl?: string,
): Promise<GatewayLoginResult> {
  const trimmedUser = username.trim();
  const trimmedPass = password;
  if (!trimmedUser || !trimmedPass) {
    return { success: false, error: 'Username and password are required.' };
  }

  const client = new GatewayClient(baseUrl ?? resolveGatewayBaseUrl());
  try {
    const { token, user } = await client.login(trimmedUser, trimmedPass);
    await persistGatewaySession(token);
    return { success: true, user };
  } catch (err) {
    return { success: false, error: sanitizeGatewayLoginError(err) };
  }
}
