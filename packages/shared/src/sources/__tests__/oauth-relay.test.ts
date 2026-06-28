import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { decodeOAuthRelayState, isOAuthRelayState } from '../../auth/oauth-relay.ts';
import { SourceCredentialManager } from '../credential-manager.ts';
import type { LoadedSource, FolderSourceConfig } from '../types.ts';

function createApiSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-id',
      slug: 'gmail-test',
      name: 'Gmail Test',
      type: 'api',
      provider: 'google',
      enabled: true,
      api: {
        baseUrl: 'https://gmail.googleapis.com/',
        authType: 'bearer',
        googleService: 'gmail',
        googleOAuthClientId: 'test-client-id',
        googleOAuthClientSecret: 'test-client-secret',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/gmail-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

function createSlackSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'slack-id',
      slug: 'slack-test',
      name: 'Slack Test',
      type: 'api',
      provider: 'slack',
      enabled: true,
      api: {
        baseUrl: 'https://slack.com/api/',
        authType: 'bearer',
        slackService: 'messaging',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/slack-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

function createMcpSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-mcp-id',
      slug: 'mcp-test',
      name: 'MCP Test',
      type: 'mcp',
      enabled: true,
      mcp: {
        transport: 'http',
        url: 'https://example.com/mcp',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/mcp-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

describe('SourceCredentialManager.prepareOAuth relay wrapping', () => {
  const credManager = new SourceCredentialManager();
  const prevRelayEnv = process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL;
  const prevSlackRelayEnv = process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL;
  const prevSlackClientId = process.env.SLACK_OAUTH_CLIENT_ID;
  const prevSlackClientSecret = process.env.SLACK_OAUTH_CLIENT_SECRET;

  beforeEach(() => {
    delete process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL;
    process.env.SLACK_OAUTH_CLIENT_ID = 'test-slack-client';
    process.env.SLACK_OAUTH_CLIENT_SECRET = 'test-slack-secret';
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === 'https://example.com/.well-known/oauth-authorization-server') {
        return Promise.resolve(Response.json({
          authorization_endpoint: 'https://example.com/oauth/authorize',
          token_endpoint: 'https://example.com/oauth/token',
        }));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    if (prevRelayEnv === undefined) delete process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL;
    else process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL = prevRelayEnv;
    if (prevSlackRelayEnv === undefined) delete process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL;
    else process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL = prevSlackRelayEnv;
    if (prevSlackClientId === undefined) delete process.env.SLACK_OAUTH_CLIENT_ID;
    else process.env.SLACK_OAUTH_CLIENT_ID = prevSlackClientId;
    if (prevSlackClientSecret === undefined) delete process.env.SLACK_OAUTH_CLIENT_SECRET;
    else process.env.SLACK_OAUTH_CLIENT_SECRET = prevSlackClientSecret;
  });

  it('uses deployment callbackUrl directly when relay env is unset (no craft.do default)', async () => {
    const deploymentUrl = 'https://my-origincoworks.example/api/oauth/callback';
    const result = await credManager.prepareOAuth(createApiSource(), {
      callbackUrl: deploymentUrl,
    });

    expect(result.redirectUri).toBe(deploymentUrl);
    expect(result.state).toBeTruthy();

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(deploymentUrl);
    expect(isOAuthRelayState(authUrl.searchParams.get('state') ?? '')).toBe(false);
  });

  it('uses direct callbackUrl for desktop-style localhost when relay env is unset', async () => {
    const deploymentUrl = 'http://localhost:6477/callback';
    const result = await credManager.prepareOAuth(createApiSource(), {
      callbackUrl: deploymentUrl,
    });

    expect(result.redirectUri).toBe(deploymentUrl);
    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(deploymentUrl);
    expect(isOAuthRelayState(authUrl.searchParams.get('state') ?? '')).toBe(false);
  });

  it('uses CRAFT_OAUTH_RELAY_CALLBACK_URL when set for WebUI flows', async () => {
    const relayUrl = 'https://relay.example/auth/callback';
    process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL = relayUrl;
    const deploymentUrl = 'https://webui.example/api/oauth/callback';

    const result = await credManager.prepareOAuth(createApiSource(), {
      callbackUrl: deploymentUrl,
    });

    expect(result.redirectUri).toBe(relayUrl);
    expect(result.state).toBeTruthy();

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(relayUrl);

    const outerState = authUrl.searchParams.get('state');
    expect(outerState).toBeTruthy();
    expect(isOAuthRelayState(outerState!)).toBe(true);
    expect(decodeOAuthRelayState(outerState!)).toEqual({
      returnTo: deploymentUrl,
      innerState: result.state,
    });
  });

  it('Slack uses deployment callbackUrl directly and ignores generic OAuth relay envelope', async () => {
    const relayUrl = 'https://relay.example/auth/callback';
    process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL = relayUrl;
    const deploymentUrl = 'https://webui.example/api/oauth/callback';

    const result = await credManager.prepareOAuth(createSlackSource(), {
      callbackUrl: deploymentUrl,
    });

    expect(result.redirectUri).toBe(deploymentUrl);
    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(deploymentUrl);
    expect(isOAuthRelayState(authUrl.searchParams.get('state') ?? '')).toBe(false);
    expect(result.authUrl).not.toContain('agents.craft.do');
  });

  it('Slack Electron flow uses CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL with port', async () => {
    delete process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL;
    process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL = 'https://relay.example/auth/slack/callback';

    const result = await credManager.prepareOAuth(createSlackSource(), {
      callbackPort: 6477,
    });

    expect(result.redirectUri).toBe('https://relay.example/auth/slack/callback?port=6477');
    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'https://relay.example/auth/slack/callback?port=6477',
    );
  });

  it('Slack prepareOAuth rejects callbackPort when Slack relay env unset', async () => {
    delete process.env.CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL;
    await expect(
      credManager.prepareOAuth(createSlackSource(), { callbackPort: 6477 }),
    ).rejects.toThrow(/CRAFT_SLACK_OAUTH_RELAY_CALLBACK_URL/);
  });

  it('passes relay redirect URI into MCP prepare when relay env is set', async () => {
    const relayUrl = 'https://relay.example/auth/callback';
    process.env.CRAFT_OAUTH_RELAY_CALLBACK_URL = relayUrl;
    const deploymentUrl = 'https://webui.example/api/oauth/callback';

    const result = await credManager.prepareOAuth(createMcpSource(), {
      callbackUrl: deploymentUrl,
    });

    expect(result.redirectUri).toBe(relayUrl);

    const authUrl = new URL(result.authUrl);
    expect(authUrl.origin + authUrl.pathname).toBe('https://example.com/oauth/authorize');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(relayUrl);

    const outerState = authUrl.searchParams.get('state');
    expect(outerState).toBeTruthy();
    expect(isOAuthRelayState(outerState!)).toBe(true);
    expect(decodeOAuthRelayState(outerState!)).toEqual({
      returnTo: deploymentUrl,
      innerState: result.state,
    });
  });
});
