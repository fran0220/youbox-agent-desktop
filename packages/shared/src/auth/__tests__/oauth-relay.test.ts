import { describe, expect, it } from 'bun:test';

import {
  decodeOAuthRelayState,
  encodeOAuthRelayState,
  isOAuthRelayState,
  resolveOAuthRelayCallbackUrl,
  wrapPreparedOAuthFlowForRelay,
} from '../oauth-relay.ts';
import type { PreparedOAuthFlow } from '../oauth-flow-types.ts';

describe('resolveOAuthRelayCallbackUrl', () => {
  const prev = process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL;

  it('returns undefined when env is unset', () => {
    delete process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL;
    expect(resolveOAuthRelayCallbackUrl()).toBeUndefined();
  });

  it('returns trimmed env value when set', () => {
    process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL = '  https://relay.example/auth/callback  ';
    expect(resolveOAuthRelayCallbackUrl()).toBe('https://relay.example/auth/callback');
    if (prev === undefined) delete process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL;
    else process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL = prev;
  });
});

describe('oauth relay state', () => {
  it('round-trips the relay callback target and inner state', () => {
    const encoded = encodeOAuthRelayState(
      'https://ghalmos.craftdocs-cf-t1.com/api/oauth/callback',
      'inner-state-123',
    );

    expect(isOAuthRelayState(encoded)).toBe(true);
    expect(decodeOAuthRelayState(encoded)).toEqual({
      returnTo: 'https://ghalmos.craftdocs-cf-t1.com/api/oauth/callback',
      innerState: 'inner-state-123',
    });
  });

  it('rejects malformed relay state', () => {
    expect(() => decodeOAuthRelayState('ca1.not-valid-base64')).toThrow('Invalid OAuth relay state');
  });
});

describe('wrapPreparedOAuthFlowForRelay', () => {
  it('keeps the inner flow state but rewrites auth URL state and redirect_uri', () => {
    const prepared: PreparedOAuthFlow = {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test-client&redirect_uri=https%3A%2F%2Fold.example%2Fcallback&response_type=code&state=inner-state-123',
      state: 'inner-state-123',
      codeVerifier: 'verifier',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'https://old.example/callback',
      provider: 'google',
    };

    const relayUrl = 'https://relay.example/auth/callback';
    const wrapped = wrapPreparedOAuthFlowForRelay(
      prepared,
      'https://ghalmos.craftdocs-cf-t1.com/api/oauth/callback',
      relayUrl,
    );

    expect(wrapped.state).toBe('inner-state-123');
    expect(wrapped.redirectUri).toBe(relayUrl);

    const authUrl = new URL(wrapped.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(relayUrl);

    const outerState = authUrl.searchParams.get('state');
    expect(outerState).toBeTruthy();
    expect(outerState).not.toBe('inner-state-123');
    expect(isOAuthRelayState(outerState!)).toBe(true);
    expect(decodeOAuthRelayState(outerState!)).toEqual({
      returnTo: 'https://ghalmos.craftdocs-cf-t1.com/api/oauth/callback',
      innerState: 'inner-state-123',
    });
  });
});
