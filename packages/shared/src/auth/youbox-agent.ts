import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hostname, platform as osPlatform } from 'node:os';
import {
  addLlmConnection,
  defaultMidStreamBehavior,
  getLlmConnection,
  getYouBoxAgentDeviceId,
  setDefaultLlmConnection,
  setSetupDeferred,
  setYouBoxAgentDeviceId,
  updateLlmConnection,
  type LlmConnection,
} from '../config/index.ts';
import { getCredentialManager } from '../credentials/index.ts';

export const YOUBOX_AGENT_CLIENT_ID = 'youbox-agent';
export const YOUBOX_GATEWAY_CONNECTION_SLUG = 'youbox-gateway';

const DEFAULT_YOUBOX_CORE_URL = 'https://api.you-box.com';
const DEFAULT_YOUBOX_AGENT_SERVICE_URL = 'https://agent.you-box.com';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export interface YouBoxAgentAuthResult {
  success: boolean;
  error?: string;
  warning?: string;
  grantId?: number;
  deviceId?: string;
}

interface PendingYouBoxAuthFlow {
  state: string;
  codeVerifier: string;
  deviceId: string;
  deviceLabel: string;
  coreUrl: string;
  agentServiceUrl: string;
  expiresAt: number;
  promise: Promise<YouBoxAgentAuthResult>;
  resolve: (result: YouBoxAgentAuthResult) => void;
}

interface TokenPairResponse {
  access_token: string;
  refresh_token: string;
  gateway_token: string;
  token_type: string;
  expires_in: number;
  grant_id: number;
}

interface AgentModelItem {
  id: string;
  name?: string;
  available?: boolean;
  capabilities?: string[];
}

interface AgentModelsResponse {
  models: AgentModelItem[];
  default_model?: string;
}

let pendingFlow: PendingYouBoxAuthFlow | null = null;

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/\/$/, '');
}

export function getYouBoxCoreUrl(): string {
  return normalizeBaseUrl(process.env.YOUBOX_CORE_URL, DEFAULT_YOUBOX_CORE_URL);
}

export function getYouBoxAgentServiceUrl(): string {
  return normalizeBaseUrl(process.env.YOUBOX_AGENT_SERVICE_URL, DEFAULT_YOUBOX_AGENT_SERVICE_URL);
}

export function getYouBoxGatewayBaseUrl(coreUrl = getYouBoxCoreUrl()): string {
  return `${normalizeBaseUrl(coreUrl, DEFAULT_YOUBOX_CORE_URL)}/v1`;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function randomPkceString(): string {
  return base64Url(randomBytes(32));
}

function pkceChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest());
}

function getOrCreateDeviceId(): string {
  const existing = getYouBoxAgentDeviceId();
  if (existing) return existing;
  const deviceId = randomUUID();
  setYouBoxAgentDeviceId(deviceId);
  return deviceId;
}

function defaultDeviceLabel(): string {
  return `${hostname() || 'Desktop'} (${osPlatform()})`;
}

function appVersion(): string {
  return process.env.CRAFT_AGENT_VERSION || process.env.npm_package_version || '0.10.4';
}

async function unwrapYouBoxResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 300) || fallbackMessage);
    }
  }
  if (!response.ok) {
    throw new Error(parsed?.message || parsed?.error || `${fallbackMessage} (${response.status})`);
  }
  if (parsed && parsed.success === false) {
    throw new Error(parsed.message || parsed.error || fallbackMessage);
  }
  return (parsed?.data ?? parsed) as T;
}

function assertPendingFlow(): PendingYouBoxAuthFlow {
  const flow = pendingFlow;
  if (!flow || Date.now() > flow.expiresAt) {
    pendingFlow = null;
    throw new Error('YouBox sign-in session expired. Please start again.');
  }
  return flow;
}

export function prepareYouBoxAgentAuth(): { success: true; authUrl: string; state: string; deviceId: string } {
  if (pendingFlow) {
    pendingFlow.resolve({ success: false, error: 'YouBox sign-in was restarted.' });
    pendingFlow = null;
  }

  const coreUrl = getYouBoxCoreUrl();
  const agentServiceUrl = getYouBoxAgentServiceUrl();
  const deviceId = getOrCreateDeviceId();
  const deviceLabel = defaultDeviceLabel();
  const state = randomPkceString();
  const codeVerifier = randomPkceString();
  const codeChallenge = pkceChallenge(codeVerifier);

  let resolve!: (result: YouBoxAgentAuthResult) => void;
  const promise = new Promise<YouBoxAgentAuthResult>((r) => { resolve = r; });
  pendingFlow = {
    state,
    codeVerifier,
    deviceId,
    deviceLabel,
    coreUrl,
    agentServiceUrl,
    expiresAt: Date.now() + AUTH_TIMEOUT_MS,
    promise,
    resolve,
  };

  const authUrl = new URL('/agent/authorize', coreUrl);
  authUrl.searchParams.set('client_id', YOUBOX_AGENT_CLIENT_ID);
  authUrl.searchParams.set('device_id', deviceId);
  authUrl.searchParams.set('device_label', deviceLabel);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return { success: true, authUrl: authUrl.toString(), state, deviceId };
}

export async function waitForYouBoxAgentAuth(): Promise<YouBoxAgentAuthResult> {
  return assertPendingFlow().promise;
}

export function cancelYouBoxAgentAuth(): { success: true } {
  if (pendingFlow) {
    pendingFlow.resolve({ success: false, error: 'YouBox sign-in was cancelled.' });
    pendingFlow = null;
  }
  return { success: true };
}

function isYouBoxAuthDeepLink(parsed: URL): boolean {
  const scheme = (process.env.YOUBOX_DEEPLINK_SCHEME || process.env.CRAFT_DEEPLINK_SCHEME || 'youbox-agent').toLowerCase();
  const protocol = parsed.protocol.replace(/:$/, '').toLowerCase();
  return protocol === scheme && parsed.hostname === 'auth';
}

export async function handleYouBoxAgentAuthDeepLink(url: string): Promise<{ handled: boolean } & YouBoxAgentAuthResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { handled: false, success: false };
  }
  if (!isYouBoxAuthDeepLink(parsed)) {
    return { handled: false, success: false };
  }

  try {
    const flow = assertPendingFlow();
    const code = parsed.searchParams.get('code')?.trim() || '';
    const state = parsed.searchParams.get('state')?.trim() || '';
    if (!code || state !== flow.state) {
      throw new Error('Invalid YouBox sign-in callback.');
    }

    const tokenPair = await exchangeYouBoxAgentCode(flow, code);
    const result = await persistYouBoxAgentTokens(flow, tokenPair);
    flow.resolve(result);
    pendingFlow = null;
    return { handled: true, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pendingFlow?.resolve({ success: false, error: message });
    pendingFlow = null;
    return { handled: true, success: false, error: message };
  }
}

async function exchangeYouBoxAgentCode(flow: PendingYouBoxAuthFlow, code: string): Promise<TokenPairResponse> {
  const response = await fetch(`${flow.coreUrl}/api/agent/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: YOUBOX_AGENT_CLIENT_ID,
      device_id: flow.deviceId,
      device_label: flow.deviceLabel,
      state: flow.state,
      code_verifier: flow.codeVerifier,
      platform: osPlatform(),
      app_version: appVersion(),
    }),
  });
  return unwrapYouBoxResponse<TokenPairResponse>(response, 'Failed to exchange YouBox authorization code');
}

async function refreshYouBoxAgentTokenBundle(credentials: {
  refreshToken: string;
  deviceId: string;
  grantId: number;
  coreUrl: string;
}): Promise<TokenPairResponse> {
  const response = await fetch(`${credentials.coreUrl}/api/agent/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: credentials.refreshToken,
      client_id: YOUBOX_AGENT_CLIENT_ID,
      device_id: credentials.deviceId,
      grant_id: credentials.grantId,
    }),
  });
  return unwrapYouBoxResponse<TokenPairResponse>(response, 'Failed to refresh YouBox Agent token');
}

async function fetchYouBoxModels(coreUrl: string, accessToken: string): Promise<AgentModelsResponse> {
  const response = await fetch(`${coreUrl}/api/agent/models`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return unwrapYouBoxResponse<AgentModelsResponse>(response, 'Failed to load YouBox model list');
}

function modelIdsFromResponse(models: AgentModelsResponse): string[] {
  const available = (models.models ?? [])
    .filter((m) => m.available !== false)
    .map((m) => m.id)
    .filter(Boolean);
  return available.length > 0 ? available : ['gpt-5.3-codex'];
}

async function upsertYouBoxGatewayConnection(coreUrl: string, gatewayToken: string, models: AgentModelsResponse): Promise<void> {
  const modelIds = modelIdsFromResponse(models);
  const defaultModel = models.default_model && modelIds.includes(models.default_model)
    ? models.default_model
    : modelIds[0]!;
  const connection: LlmConnection = {
    slug: YOUBOX_GATEWAY_CONNECTION_SLUG,
    name: 'YouBox Gateway',
    providerType: 'pi_compat',
    authType: 'api_key_with_endpoint',
    baseUrl: getYouBoxGatewayBaseUrl(coreUrl),
    models: modelIds,
    defaultModel,
    modelSelectionMode: 'userDefined3Tier',
    piAuthProvider: 'openai',
    customEndpoint: {
      api: 'openai-completions',
      supportsImages: (models.models ?? []).some((m) => m.capabilities?.includes('vision')),
    },
    midStreamBehavior: defaultMidStreamBehavior('pi_compat'),
    createdAt: Date.now(),
  };

  if (getLlmConnection(YOUBOX_GATEWAY_CONNECTION_SLUG)) {
    const { slug: _slug, createdAt: _createdAt, ...updates } = connection;
    updateLlmConnection(YOUBOX_GATEWAY_CONNECTION_SLUG, updates);
  } else {
    addLlmConnection(connection);
  }
  setDefaultLlmConnection(YOUBOX_GATEWAY_CONNECTION_SLUG);

  const manager = getCredentialManager();
  await manager.setLlmApiKey(YOUBOX_GATEWAY_CONNECTION_SLUG, gatewayToken);
}

async function persistYouBoxAgentTokens(
  flow: Pick<PendingYouBoxAuthFlow, 'coreUrl' | 'agentServiceUrl' | 'deviceId'>,
  tokenPair: TokenPairResponse,
): Promise<YouBoxAgentAuthResult> {
  const manager = getCredentialManager();
  const expiresAt = Date.now() + tokenPair.expires_in * 1000;
  await manager.setYouBoxAgentCredentials({
    accessToken: tokenPair.access_token,
    refreshToken: tokenPair.refresh_token,
    gatewayToken: tokenPair.gateway_token,
    expiresAt,
    grantId: tokenPair.grant_id,
    deviceId: flow.deviceId,
    coreUrl: flow.coreUrl,
    agentServiceUrl: flow.agentServiceUrl,
  });

  const models = await fetchYouBoxModels(flow.coreUrl, tokenPair.access_token);
  await upsertYouBoxGatewayConnection(flow.coreUrl, tokenPair.gateway_token, models);
  setSetupDeferred(false);

  let warning: string | undefined;
  try {
    await bootstrapYouBoxAgentService({
      accessToken: tokenPair.access_token,
      agentServiceUrl: flow.agentServiceUrl,
      deviceLabel: defaultDeviceLabel(),
    });
  } catch (error) {
    warning = error instanceof Error ? error.message : String(error);
  }

  return { success: true, warning, grantId: tokenPair.grant_id, deviceId: flow.deviceId };
}

export async function getValidYouBoxAgentCredentials(): Promise<{
  accessToken: string;
  gatewayToken: string;
  grantId: number;
  deviceId: string;
  coreUrl: string;
  agentServiceUrl: string;
} | null> {
  const manager = getCredentialManager();
  const credentials = await manager.getYouBoxAgentCredentials();
  if (!credentials?.accessToken || !credentials.refreshToken || !credentials.gatewayToken || !credentials.grantId || !credentials.deviceId) {
    return null;
  }

  const coreUrl = normalizeBaseUrl(credentials.coreUrl, getYouBoxCoreUrl());
  const agentServiceUrl = normalizeBaseUrl(credentials.agentServiceUrl, getYouBoxAgentServiceUrl());
  if (!credentials.expiresAt || Date.now() > credentials.expiresAt - 5 * 60 * 1000) {
    const refreshed = await refreshYouBoxAgentTokenBundle({
      refreshToken: credentials.refreshToken,
      deviceId: credentials.deviceId,
      grantId: credentials.grantId,
      coreUrl,
    });
    await persistYouBoxAgentTokens({ coreUrl, agentServiceUrl, deviceId: credentials.deviceId }, refreshed);
    return {
      accessToken: refreshed.access_token,
      gatewayToken: refreshed.gateway_token,
      grantId: refreshed.grant_id,
      deviceId: credentials.deviceId,
      coreUrl,
      agentServiceUrl,
    };
  }

  return {
    accessToken: credentials.accessToken,
    gatewayToken: credentials.gatewayToken,
    grantId: credentials.grantId,
    deviceId: credentials.deviceId,
    coreUrl,
    agentServiceUrl,
  };
}

export async function bootstrapYouBoxAgentService(args: {
  accessToken: string;
  agentServiceUrl?: string;
  deviceLabel?: string;
}): Promise<unknown> {
  const agentServiceUrl = normalizeBaseUrl(args.agentServiceUrl, getYouBoxAgentServiceUrl());
  const headers = {
    Authorization: `Bearer ${args.accessToken}`,
    'Content-Type': 'application/json',
  };
  await unwrapYouBoxResponse(await fetch(`${agentServiceUrl}/agent/v1/devices/current/heartbeat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      device_name: args.deviceLabel || defaultDeviceLabel(),
      platform: osPlatform(),
      app_version: appVersion(),
    }),
  }), 'Failed to heartbeat YouBox Agent Service');
  return unwrapYouBoxResponse(await fetch(`${agentServiceUrl}/agent/v1/bootstrap`, { headers }), 'Failed to bootstrap YouBox Agent Service');
}

export async function logoutYouBoxAgent(): Promise<void> {
  const manager = getCredentialManager();
  const credentials = await manager.getYouBoxAgentCredentials();
  if (credentials?.accessToken && credentials.refreshToken && credentials.deviceId && credentials.grantId && credentials.coreUrl) {
    const coreUrl = normalizeBaseUrl(credentials.coreUrl, getYouBoxCoreUrl());
    let accessToken = credentials.accessToken;
    if (!credentials.expiresAt || Date.now() > credentials.expiresAt - 5 * 60 * 1000) {
      try {
        const refreshed = await refreshYouBoxAgentTokenBundle({
          refreshToken: credentials.refreshToken,
          deviceId: credentials.deviceId,
          grantId: credentials.grantId,
          coreUrl,
        });
        accessToken = refreshed.access_token;
      } catch {
        // Continue with the existing access token; local credentials are deleted below
        // even if the server-side revoke cannot be completed.
      }
    }

    await fetch(`${coreUrl}/api/agent/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ device_id: credentials.deviceId }),
    }).catch(() => undefined);
  }
  await manager.deleteYouBoxAgentCredentials();
  await manager.deleteLlmCredentials(YOUBOX_GATEWAY_CONNECTION_SLUG);
}
