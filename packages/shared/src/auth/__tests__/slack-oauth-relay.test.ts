import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { prepareSlackOAuth } from '../slack-oauth.ts';

describe('prepareSlackOAuth redirect relay', () => {
  const prevClientId = process.env.SLACK_OAUTH_CLIENT_ID;
  const prevClientSecret = process.env.SLACK_OAUTH_CLIENT_SECRET;
  const prevSlackRelay = process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL;

  beforeEach(() => {
    process.env.SLACK_OAUTH_CLIENT_ID = 'test-slack-client';
    process.env.SLACK_OAUTH_CLIENT_SECRET = 'test-slack-secret';
  });

  afterEach(() => {
    if (prevClientId === undefined) delete process.env.SLACK_OAUTH_CLIENT_ID;
    else process.env.SLACK_OAUTH_CLIENT_ID = prevClientId;
    if (prevClientSecret === undefined) delete process.env.SLACK_OAUTH_CLIENT_SECRET;
    else process.env.SLACK_OAUTH_CLIENT_SECRET = prevClientSecret;
    if (prevSlackRelay === undefined) delete process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL;
    else process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL = prevSlackRelay;
  });

  it('uses deployment callbackUrl when provided (no craft.do default)', () => {
    delete process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL;
    const deploymentUrl = 'https://my-origincoworks.example/api/oauth/callback';
    const prepared = prepareSlackOAuth({ service: 'messaging', callbackUrl: deploymentUrl });

    expect(prepared.redirectUri).toBe(deploymentUrl);
    const authUrl = new URL(prepared.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(deploymentUrl);
    expect(prepared.authUrl).not.toContain('agents.craft.do');
  });

  it('uses CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL with port when callbackPort set', () => {
    process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL = 'https://relay.example/auth/slack/callback';
    const prepared = prepareSlackOAuth({ service: 'messaging', callbackPort: 8123 });

    expect(prepared.redirectUri).toBe('https://relay.example/auth/slack/callback?port=8123');
    const authUrl = new URL(prepared.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'https://relay.example/auth/slack/callback?port=8123',
    );
  });

  it('throws when relay env unset and only callbackPort provided', () => {
    delete process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL;
    expect(() => prepareSlackOAuth({ service: 'messaging', callbackPort: 8123 })).toThrow(
      /CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL/,
    );
  });
});
