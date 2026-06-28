/**
 * Resolves effective workspace trust for gateway pre-tool-use gating.
 * Order: explicit policy.workspace_trusted → workspace config → policy default.
 */
import type { GatewayPolicySnapshot } from '@craft-agent/shared/agent/gateway-policy';
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces/storage.ts';

export function resolveWorkspaceTrustedForAgent(args: {
  policy: GatewayPolicySnapshot | undefined;
  workspaceRootPath: string;
}): boolean | undefined {
  const { policy, workspaceRootPath } = args;
  if (!policy) {
    return undefined;
  }

  const wsConfig = loadWorkspaceConfig(workspaceRootPath);
  if (typeof wsConfig?.gatewayTrusted === 'boolean') {
    return wsConfig.gatewayTrusted;
  }

  if (typeof policy.workspace_trusted === 'boolean') {
    return policy.workspace_trusted;
  }

  return policy.workspace_trust_default;
}
