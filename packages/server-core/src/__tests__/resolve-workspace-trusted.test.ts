import { describe, it, expect } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveWorkspaceTrustedForAgent } from '../resolve-workspace-trusted.ts';
import type { GatewayPolicySnapshot } from '@craft-agent/shared/agent/gateway-policy';

const basePolicy: GatewayPolicySnapshot = {
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
};

describe('resolveWorkspaceTrustedForAgent', () => {
  it('prefers workspace config over policy.workspace_trusted', () => {
    const dir = join(tmpdir(), `ocn-trust2-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        id: 'w1',
        name: 'Test',
        slug: 'test',
        gatewayTrusted: false,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    try {
      expect(
        resolveWorkspaceTrustedForAgent({
          policy: { ...basePolicy, workspace_trusted: true },
          workspaceRootPath: dir,
        }),
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses policy.workspace_trusted when workspace config unset', () => {
    expect(
      resolveWorkspaceTrustedForAgent({
        policy: { ...basePolicy, workspace_trusted: false },
        workspaceRootPath: '/tmp/ws',
      }),
    ).toBe(false);
  });

  it('uses workspace config gatewayTrusted when policy has no workspace_trusted', () => {
    const dir = join(tmpdir(), `ocn-trust-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        id: 'w1',
        name: 'Test',
        slug: 'test',
        gatewayTrusted: false,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    try {
      expect(
        resolveWorkspaceTrustedForAgent({
          policy: basePolicy,
          workspaceRootPath: dir,
        }),
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to workspace_trust_default', () => {
    expect(
      resolveWorkspaceTrustedForAgent({
        policy: { ...basePolicy, workspace_trust_default: false },
        workspaceRootPath: '/tmp/no-config',
      }),
    ).toBe(false);
  });
});
