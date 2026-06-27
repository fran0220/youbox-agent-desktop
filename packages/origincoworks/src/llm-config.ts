/**
 * Persist gateway desktop LLM config as the single managed Craft LlmConnection.
 */
import {
  addLlmConnection,
  ensureConfigDir,
  getLlmConnection,
  loadStoredConfig,
  saveConfig,
  setDefaultLlmConnection,
  updateLlmConnection,
  type LlmConnection,
} from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { fetchDesktopConfig } from './desktop-config.ts';
import { mapGatewayModelsToCraft } from './model-config.ts';
import { getStoredGatewayToken, resolveGatewayBaseUrl } from './auth.ts';
import type { DesktopConfigResponse } from './types.ts';

/** Stable slug for the gateway-provisioned LLM connection. */
export const ORIGINCOWORKS_GATEWAY_LLM_SLUG = 'origincoworks-gateway';

export function isGatewayManagedLlmSlug(slug: string): boolean {
  return slug === ORIGINCOWORKS_GATEWAY_LLM_SLUG;
}

export function buildGatewayLlmConnectionFromDesktopConfig(
  config: DesktopConfigResponse,
  now = Date.now(),
): LlmConnection {
  const models = mapGatewayModelsToCraft(config.models ?? []);
  const defaultModel = config.primary_model?.trim() || models[0]?.id;
  if (!defaultModel) {
    throw new Error('gateway desktop config has no primary_model and no models');
  }
  const baseUrl = config.llm_proxy_url?.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('gateway desktop config missing llm_proxy_url');
  }

  return {
    slug: ORIGINCOWORKS_GATEWAY_LLM_SLUG,
    name: 'OriginCoworks Gateway',
    providerType: 'pi_compat',
    authType: 'api_key_with_endpoint',
    baseUrl,
    models,
    defaultModel,
    modelSelectionMode: 'userDefined3Tier',
    piAuthProvider: 'openai',
    customEndpoint: { api: 'openai-completions' },
    managedByGateway: true,
    createdAt: now,
    lastUsedAt: now,
  };
}

export type ApplyGatewayLlmConfigDeps = {
  reinitializeAuth: (connectionSlug?: string) => Promise<void>;
};

/**
 * Fetch /api/desktop/config and upsert the managed connection + proxy API key.
 * Always sets this connection as the global default (gateway is source of truth).
 */
export async function applyGatewayLlmConfigFromSession(
  deps: ApplyGatewayLlmConfigDeps,
  baseUrl?: string,
): Promise<{ slug: string; config: DesktopConfigResponse }> {
  const resolvedBase = baseUrl ?? resolveGatewayBaseUrl();
  const token = await getStoredGatewayToken();
  if (!token) {
    throw new Error('no gateway session token; sign in first');
  }

  const desktopConfig = await fetchDesktopConfig(resolvedBase, token);
  const proxyKey = desktopConfig.llm_proxy_key?.trim();
  if (!proxyKey) {
    throw new Error('gateway desktop config missing llm_proxy_key');
  }

  const connection = buildGatewayLlmConnectionFromDesktopConfig(desktopConfig);
  ensureConfigDir();
  if (!loadStoredConfig()) {
    saveConfig({
      workspaces: [],
      activeWorkspaceId: null,
      activeSessionId: null,
    });
  }

  const existing = getLlmConnection(ORIGINCOWORKS_GATEWAY_LLM_SLUG);
  const manager = getCredentialManager();

  if (!existing) {
    const added = addLlmConnection(connection);
    if (!added) {
      throw new Error('failed to add gateway LLM connection');
    }
  } else {
    const { slug: _slug, createdAt, ...updates } = connection;
    const updated = updateLlmConnection(ORIGINCOWORKS_GATEWAY_LLM_SLUG, {
      ...updates,
      createdAt: existing.createdAt,
    });
    if (!updated) {
      throw new Error('failed to update gateway LLM connection');
    }
  }

  await manager.setLlmApiKey(ORIGINCOWORKS_GATEWAY_LLM_SLUG, proxyKey);
  setDefaultLlmConnection(ORIGINCOWORKS_GATEWAY_LLM_SLUG);
  await deps.reinitializeAuth(ORIGINCOWORKS_GATEWAY_LLM_SLUG);

  return { slug: ORIGINCOWORKS_GATEWAY_LLM_SLUG, config: desktopConfig };
}
