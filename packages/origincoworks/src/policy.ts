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

let cachedPolicy: GatewayPolicySnapshot | undefined;
let cachedAtMs = 0;
const CACHE_TTL_MS = 60_000;

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
  return {
    role: String(o.role),
    flags: parseFlags(o.flags),
    workspace_trust_default: o.workspace_trust_default !== false,
    require_high_risk_confirmation: o.require_high_risk_confirmation !== false,
    require_admin_escalation_approval: o.require_admin_escalation_approval !== false,
  };
}

export async function fetchDesktopPolicy(
  client: GatewayClient,
): Promise<GatewayPolicySnapshot> {
  const body = await client.desktopPolicy();
  return mapDesktopPolicyResponse(body);
}

export async function getCachedGatewayPolicy(
  baseUrl: string,
  token?: string,
): Promise<GatewayPolicySnapshot | undefined> {
  if (!token) return undefined;
  const now = Date.now();
  if (cachedPolicy && now - cachedAtMs < CACHE_TTL_MS) {
    return cachedPolicy;
  }
  try {
    const client = new GatewayClient(baseUrl, token);
    cachedPolicy = await fetchDesktopPolicy(client);
    cachedAtMs = now;
    return cachedPolicy;
  } catch {
    return cachedPolicy;
  }
}

export function clearGatewayPolicyCacheForTests(): void {
  cachedPolicy = undefined;
  cachedAtMs = 0;
}
