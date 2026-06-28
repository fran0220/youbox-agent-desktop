/**
 * Gateway role / workspace-trust policy — fetch + cache for pre-tool-use gating.
 */
import { GatewayClient } from './gateway-client.ts';
import {
  type GatewayPolicySnapshot,
  type GatewayPolicyFlags,
} from '@craft-agent/shared/agent/gateway-policy';

export type { GatewayPolicySnapshot, GatewayPolicyFlags };

export {
  evaluateGatewayPolicy,
  isHighRiskBashCommand,
  shouldPromptHighRiskInAllowAll,
} from '@craft-agent/shared/agent/gateway-policy';

const DEFAULT_FLAGS: GatewayPolicyFlags = {
  allow_bash: true,
  allow_file_write: true,
  allow_mcp: true,
  allow_api_mutations: true,
};

type PolicyCacheEntry = { policy: GatewayPolicySnapshot; atMs: number };

const policyCache = new Map<string, PolicyCacheEntry>();
const CACHE_TTL_MS = 60_000;

function policyCacheKey(baseUrl: string, token: string, workspaceSlug?: string): string {
  const slug = workspaceSlug?.trim() ?? '';
  return `${baseUrl}\0${token}\0${slug}`;
}

function parseFlags(raw: unknown): GatewayPolicyFlags {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FLAGS };
  const o = raw as Record<string, unknown>;
  return {
    allow_bash: o.allow_bash !== false,
    allow_file_write: o.allow_file_write !== false,
    allow_mcp: o.allow_mcp !== false,
    allow_api_mutations: o.allow_api_mutations !== false,
  };
}

export function assertDesktopPolicyResponse(value: unknown): asserts value is GatewayPolicySnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('desktop policy response must be an object');
  }
  const o = value as Record<string, unknown>;
  if (typeof o.role !== 'string') {
    throw new Error('desktop policy missing role');
  }
  parseFlags(o.flags);
}

export function mapDesktopPolicyResponse(value: unknown): GatewayPolicySnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('desktop policy response must be an object');
  }
  const o = value as Record<string, unknown>;
  if (typeof o.role !== 'string') {
    throw new Error('desktop policy missing role');
  }
  const workspaceTrusted =
    typeof o.workspace_trusted === 'boolean' ? o.workspace_trusted : undefined;

  return {
    role: String(o.role),
    flags: parseFlags(o.flags),
    workspace_trust_default: o.workspace_trust_default !== false,
    workspace_trusted: workspaceTrusted,
    require_high_risk_confirmation: o.require_high_risk_confirmation !== false,
    require_admin_escalation_approval: o.require_admin_escalation_approval !== false,
  };
}

export async function fetchDesktopPolicy(
  client: GatewayClient,
  workspaceSlug?: string,
): Promise<GatewayPolicySnapshot> {
  const body = await client.desktopPolicy(workspaceSlug);
  return mapDesktopPolicyResponse(body);
}

export async function getCachedGatewayPolicy(
  baseUrl: string,
  token?: string,
  workspaceSlug?: string,
): Promise<GatewayPolicySnapshot | undefined> {
  if (!token) return undefined;
  const key = policyCacheKey(baseUrl, token, workspaceSlug);
  const now = Date.now();
  const hit = policyCache.get(key);
  if (hit && now - hit.atMs < CACHE_TTL_MS) {
    return hit.policy;
  }
  try {
    const client = new GatewayClient(baseUrl, token);
    const policy = await fetchDesktopPolicy(client, workspaceSlug);
    policyCache.set(key, { policy, atMs: now });
    return policy;
  } catch {
    return hit?.policy;
  }
}

export function clearGatewayPolicyCacheForTests(): void {
  policyCache.clear();
}
