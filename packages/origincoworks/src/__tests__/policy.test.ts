import { describe, it, expect, beforeEach } from 'bun:test';
import { GatewayClient } from '../gateway-client.ts';
import {
  mapDesktopPolicyResponse,
  clearGatewayPolicyCacheForTests,
  getCachedGatewayPolicy,
} from '../policy.ts';

describe('policy.ts', () => {
  beforeEach(() => {
    clearGatewayPolicyCacheForTests();
    GatewayClient.setFetchForTests(undefined);
  });

  it('mapDesktopPolicyResponse parses admin policy', () => {
    const snap = mapDesktopPolicyResponse({
      role: 'admin',
      flags: {
        allow_bash: true,
        allow_file_write: true,
        allow_mcp: true,
        allow_api_mutations: true,
      },
      workspace_trust_default: true,
      require_high_risk_confirmation: true,
      require_admin_escalation_approval: true,
    });
    expect(snap.role).toBe('admin');
    expect(snap.flags.allow_bash).toBe(true);
  });

  it('mapDesktopPolicyResponse restricts viewer', () => {
    const snap = mapDesktopPolicyResponse({
      role: 'viewer',
      flags: {
        allow_bash: false,
        allow_file_write: false,
        allow_mcp: false,
        allow_api_mutations: false,
      },
      workspace_trust_default: true,
      require_high_risk_confirmation: true,
      require_admin_escalation_approval: true,
    });
    expect(snap.flags.allow_bash).toBe(false);
  });

  it('getCachedGatewayPolicy fetches via desktopPolicy', async () => {
    GatewayClient.setFetchForTests(async (input) => {
      const url = String(input);
      if (!url.includes('/api/desktop/policy')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(
        JSON.stringify({
          role: 'admin',
          flags: { allow_bash: true, allow_file_write: true, allow_mcp: true, allow_api_mutations: true },
          workspace_trust_default: true,
          require_high_risk_confirmation: true,
          require_admin_escalation_approval: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const policy = await getCachedGatewayPolicy('http://127.0.0.1:8847', 'a'.repeat(64));
    expect(policy?.role).toBe('admin');
  });
});
