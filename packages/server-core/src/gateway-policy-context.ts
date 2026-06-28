/**
 * Resolves gateway policy snapshot for agent pre-tool-use gating (desktop + headless WebUI).
 */
import { getStoredGatewayToken, resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth';
import { getCachedGatewayPolicy } from '@craft-agent/origincoworks/policy';
import type { GatewayPolicySnapshot } from '@craft-agent/shared/agent/gateway-policy';

export async function resolveGatewayPolicyForRuntime(): Promise<GatewayPolicySnapshot | undefined> {
  const token = await getStoredGatewayToken();
  if (!token) return undefined;
  return getCachedGatewayPolicy(resolveGatewayBaseUrl(), token);
}
