import type { PreparedOAuthFlow } from './oauth-flow-types.ts';

const OAUTH_RELAY_STATE_PREFIX = 'ca1.';
const OAUTH_RELAY_STATE_VERSION = 1;

/**
 * Optional HTTPS OAuth relay callback registered with providers (e.g. Google Web client).
 * When unset, WebUI/headless flows use the deployment `callbackUrl` directly — no Craft relay ships by default.
 *
 * Override: `CRAFT_OAUTH_RELAY_CALLBACK_URL` (operator-hosted relay that forwards to `returnTo` in state).
 */
export function resolveOAuthRelayCallbackUrl(): string | undefined {
  const fromEnv = process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/**
 * Operator-hosted HTTPS relay for Slack source OAuth (Slack requires HTTPS redirect_uri).
 * When unset, Electron flows with only `callbackPort` cannot start — no Craft relay ships by default.
 *
 * Override: `CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL` (HTTPS endpoint that forwards to `http://localhost:{port}/callback`).
 */
export const SLACK_OAUTH_RELAY_NOT_CONFIGURED_MESSAGE =
  'Slack OAuth requires an HTTPS redirect relay. Set CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL to your operator-hosted relay URL (HTTPS endpoint that forwards to the local callback).';

export function resolveSlackOAuthRelayCallbackUrl(): string | undefined {
  const fromEnv = process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/**
 * Resolve Slack OAuth redirect_uri. WebUI/headless may pass a full HTTPS `callbackUrl` directly.
 * Electron local callback uses `callbackPort` plus `CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL` (appends `?port=`).
 */
export function buildSlackOAuthRedirectUri(options: {
  callbackUrl?: string;
  callbackPort?: number;
}): string {
  if (options.callbackUrl) {
    return options.callbackUrl;
  }

  const relayBase = resolveSlackOAuthRelayCallbackUrl();
  if (!relayBase) {
    throw new Error(SLACK_OAUTH_RELAY_NOT_CONFIGURED_MESSAGE);
  }

  if (options.callbackPort == null) {
    throw new Error(
      'Slack OAuth with a local callback requires callbackPort when CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL is set.',
    );
  }

  const relay = new URL(relayBase);
  relay.searchParams.set('port', String(options.callbackPort));
  return relay.toString();
}

interface OAuthRelayStateEnvelope {
  v: number;
  r: string;
  s: string;
}

export interface OAuthRelayState {
  returnTo: string;
  innerState: string;
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function isOAuthRelayState(value: string): boolean {
  return value.startsWith(OAUTH_RELAY_STATE_PREFIX);
}

export function encodeOAuthRelayState(returnTo: string, innerState: string): string {
  const envelope: OAuthRelayStateEnvelope = {
    v: OAUTH_RELAY_STATE_VERSION,
    r: returnTo,
    s: innerState,
  };
  return `${OAUTH_RELAY_STATE_PREFIX}${toBase64Url(JSON.stringify(envelope))}`;
}

export function decodeOAuthRelayState(value: string): OAuthRelayState {
  if (!isOAuthRelayState(value)) {
    throw new Error('State does not use the OAuth relay envelope');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(value.slice(OAUTH_RELAY_STATE_PREFIX.length)));
  } catch {
    throw new Error('Invalid OAuth relay state');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('v' in parsed) || parsed.v !== OAUTH_RELAY_STATE_VERSION ||
    !('r' in parsed) || typeof parsed.r !== 'string' || parsed.r.length === 0 ||
    !('s' in parsed) || typeof parsed.s !== 'string' || parsed.s.length === 0
  ) {
    throw new Error('Invalid OAuth relay state');
  }

  return {
    returnTo: parsed.r,
    innerState: parsed.s,
  };
}

export function wrapPreparedOAuthFlowForRelay(
  prepared: PreparedOAuthFlow,
  returnTo: string,
  relayCallbackUrl: string,
): PreparedOAuthFlow {
  const authUrl = new URL(prepared.authUrl);
  authUrl.searchParams.set('redirect_uri', relayCallbackUrl);
  authUrl.searchParams.set('state', encodeOAuthRelayState(returnTo, prepared.state));

  return {
    ...prepared,
    authUrl: authUrl.toString(),
    redirectUri: relayCallbackUrl,
  };
}
