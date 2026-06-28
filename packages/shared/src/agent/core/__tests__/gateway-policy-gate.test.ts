/**
 * VAL-PERM-010..014, VAL-PERM-016 at runPreToolUseChecks / gateway-policy helpers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runPreToolUseChecks,
  type PreToolUseInput,
} from '../pre-tool-use.ts';
import { PermissionManager } from '../permission-manager.ts';
import {
  initializeModeState,
  cleanupModeState,
  setPermissionMode,
} from '../../mode-manager.ts';
import type { GatewayPolicySnapshot } from '../../gateway-policy.ts';

const SESSION_ID = 'gateway-policy-gate-session';

const viewerPolicy: GatewayPolicySnapshot = {
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
};

function createInput(
  overrides: Partial<PreToolUseInput> & {
    permissionMode: PreToolUseInput['permissionMode'];
    toolName: string;
    input: Record<string, unknown>;
  },
): PreToolUseInput {
  const pm = new PermissionManager({
    workspaceId: 'ws-test',
    sessionId: SESSION_ID,
    workingDirectory: overrides.workspaceRootPath ?? '/tmp/ws',
    plansFolderPath: '/tmp/ws/plans',
  });

  return {
    sessionId: SESSION_ID,
    workspaceRootPath: '/tmp/ws',
    workspaceId: 'ws-test',
    activeSourceSlugs: ['github'],
    allSourceSlugs: ['github'],
    hasSourceActivation: true,
    permissionManager: pm,
    ...overrides,
  };
}

describe('gateway policy gate (VAL-PERM-010..014, 016)', () => {
  let probeDir: string;
  let probeFile: string;

  beforeEach(() => {
    cleanupModeState(SESSION_ID);
    initializeModeState(SESSION_ID, 'allow-all');
    probeDir = join(tmpdir(), `ocn-gwpol-${Date.now()}`);
    mkdirSync(probeDir, { recursive: true });
    probeFile = join(probeDir, 'gw-probe.txt');
  });

  afterEach(() => {
    cleanupModeState(SESSION_ID);
    try {
      rmSync(probeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('VAL-PERM-010: gateway role denies bash in allow-all', () => {
    setPermissionMode(SESSION_ID, 'allow-all', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'allow-all',
        toolName: 'Bash',
        input: { command: 'echo ok' },
        gatewayPolicy: viewerPolicy,
      }),
    );
    expect(result.type).toBe('block');
    if (result.type === 'block') {
      expect(result.source).toBe('gateway_role');
      expect(result.reason.toLowerCase()).toMatch(/gateway|policy|role|bash/);
    }
  });

  it('VAL-PERM-011: untrusted workspace blocks write in allow-all', () => {
    setPermissionMode(SESSION_ID, 'allow-all', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'allow-all',
        toolName: 'Write',
        input: { file_path: probeFile, content: 'x' },
        gatewayPolicy: {
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
        },
        workspaceTrusted: false,
      }),
    );
    expect(result.type).toBe('block');
    if (result.type === 'block') {
      expect(result.source).toBe('workspace_trust');
    }
  });

  it('VAL-PERM-012: allow-all prompts for high-risk rm -rf', () => {
    setPermissionMode(SESSION_ID, 'allow-all', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'allow-all',
        toolName: 'Bash',
        input: { command: 'rm -rf /tmp/ocn-high-risk-probe' },
        gatewayPolicy: {
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
        },
      }),
    );
    expect(result.type).toBe('prompt');
    if (result.type === 'prompt') {
      expect(result.promptType).toBe('bash');
      expect(result.description.toLowerCase()).toMatch(/high-risk|confirmation/);
    }
  });

  it('VAL-PERM-013: admin escalation uses admin_approval in ask mode', () => {
    setPermissionMode(SESSION_ID, 'ask', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'ask',
        toolName: 'Bash',
        input: { command: 'brew install --cask firefox' },
      }),
    );
    expect(result.type).toBe('prompt');
    if (result.type === 'prompt') {
      expect(result.promptType).toBe('admin_approval');
    }
  });

  it('VAL-PERM-014: inactive MCP source blocked', () => {
    setPermissionMode(SESSION_ID, 'allow-all', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'allow-all',
        toolName: 'mcp__github__create_issue',
        input: { title: 'x' },
        activeSourceSlugs: [],
        allSourceSlugs: ['github'],
      }),
    );
    expect(result.type).toBe('source_activation_needed');
  });

  it('VAL-PERM-016: API mutation blocked when not allowlisted in safe mode', () => {
    setPermissionMode(SESSION_ID, 'safe', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'safe',
        toolName: 'api_github',
        input: { method: 'POST', path: '/repos/org/private-repo' },
        activeSourceSlugs: ['github'],
      }),
    );
    expect(result.type).toBe('block');
  });
});

describe('VAL-PERM-015: remote runtime uses same pipeline', () => {
  it('safe mode blocks Write when gateway policy absent (headless path)', () => {
    const SESSION = 'webui-perm-parity';
    cleanupModeState(SESSION);
    initializeModeState(SESSION, 'safe');
    const pm = new PermissionManager({
      workspaceId: 'ws-webui',
      sessionId: SESSION,
      workingDirectory: '/tmp/ws',
      plansFolderPath: '/tmp/ws/plans',
    });
    const result = runPreToolUseChecks({
      sessionId: SESSION,
      toolName: 'Write',
      input: { file_path: '/tmp/ws/out.txt', content: 'x' },
      permissionMode: 'safe',
      workspaceRootPath: '/tmp/ws',
      workspaceId: 'ws-webui',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      permissionManager: pm,
      gatewayPolicy: undefined,
    });
    expect(result.type).toBe('block');
    cleanupModeState(SESSION);
  });
});
