/**
 * Integration tests for VAL-PERM-001 through VAL-PERM-009 at runPreToolUseChecks().
 * Uses real mode-manager + PermissionManager (no module mocks).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

const SESSION_ID = 'perm-modes-integration-session';

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
    activeSourceSlugs: [],
    allSourceSlugs: [],
    hasSourceActivation: false,
    permissionManager: pm,
    ...overrides,
  };
}

describe('permission modes at runPreToolUseChecks (VAL-PERM-001..009)', () => {
  let probeDir: string;
  let probeFile: string;

  beforeEach(() => {
    cleanupModeState(SESSION_ID);
    initializeModeState(SESSION_ID, 'safe');
    probeDir = join(tmpdir(), `ocn-perm-${Date.now()}`);
    mkdirSync(probeDir, { recursive: true });
    probeFile = join(probeDir, 'perm-probe.txt');
  });

  afterEach(() => {
    cleanupModeState(SESSION_ID);
    try {
      rmSync(probeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('VAL-PERM-001: safe mode blocks Write', () => {
    setPermissionMode(SESSION_ID, 'safe', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'safe',
        toolName: 'Write',
        input: { file_path: probeFile, content: 'probe' },
      }),
    );
    expect(result.type).toBe('block');
    if (result.type === 'block') {
      expect(result.reason.toLowerCase()).toMatch(/explore|safe|blocked|write/);
    }
  });

  it('VAL-PERM-002: safe mode blocks state-changing Bash', () => {
    setPermissionMode(SESSION_ID, 'safe', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'safe',
        toolName: 'Bash',
        input: { command: `touch ${probeFile}` },
      }),
    );
    expect(result.type).toBe('block');
  });

  it('VAL-PERM-003: safe mode allows Read', () => {
    writeFileSync(probeFile, 'hello', 'utf8');
    setPermissionMode(SESSION_ID, 'safe', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'safe',
        toolName: 'Read',
        input: { file_path: probeFile },
      }),
    );
    expect(result.type).toBe('allow');
  });

  it('VAL-PERM-003: safe mode allows read-only Bash (ls)', () => {
    setPermissionMode(SESSION_ID, 'safe', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'safe',
        toolName: 'Bash',
        input: { command: 'ls -la' },
      }),
    );
    expect(result.type).toBe('allow');
  });

  it('VAL-PERM-004: ask mode prompts before Write', () => {
    setPermissionMode(SESSION_ID, 'ask', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'ask',
        toolName: 'Write',
        input: { file_path: probeFile, content: 'x' },
      }),
    );
    expect(result.type).toBe('prompt');
    if (result.type === 'prompt') {
      expect(result.promptType).toBe('file_write');
    }
  });

  it('VAL-PERM-007: ask mode prompts before mutating Bash', () => {
    setPermissionMode(SESSION_ID, 'ask', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'ask',
        toolName: 'Bash',
        input: { command: 'npm install left-pad' },
      }),
    );
    expect(result.type).toBe('prompt');
    if (result.type === 'prompt') {
      expect(result.promptType).toBe('bash');
    }
  });

  it('VAL-PERM-008: allow-all auto-allows Write', () => {
    setPermissionMode(SESSION_ID, 'allow-all', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'allow-all',
        toolName: 'Write',
        input: { file_path: probeFile, content: 'ok' },
      }),
    );
    expect(result.type).toBe('allow');
  });

  it('VAL-PERM-008: allow-all auto-allows Bash', () => {
    setPermissionMode(SESSION_ID, 'allow-all', { changedBy: 'user' });
    const result = runPreToolUseChecks(
      createInput({
        permissionMode: 'allow-all',
        toolName: 'Bash',
        input: { command: `touch ${probeFile}` },
      }),
    );
    expect(result.type).toBe('allow');
  });

  it('VAL-PERM-009: whitelisted bash skips repeat ask prompt', () => {
    setPermissionMode(SESSION_ID, 'ask', { changedBy: 'user' });
    const pm = new PermissionManager({
      workspaceId: 'ws-test',
      sessionId: SESSION_ID,
      workingDirectory: '/tmp/ws',
      plansFolderPath: '/tmp/ws/plans',
    });
    pm.whitelistCommand('echo');

    const base = {
      permissionMode: 'ask' as const,
      toolName: 'Bash',
      input: { command: 'echo OCN_PERM_MARKER' },
      permissionManager: pm,
    };

    const first = runPreToolUseChecks(createInput(base));
    expect(first.type).toBe('allow');

    const second = runPreToolUseChecks(createInput(base));
    expect(second.type).toBe('allow');
  });

  it('VAL-PERM-006: write target absent before user approves ask prompt', () => {
    setPermissionMode(SESSION_ID, 'ask', { changedBy: 'user' });
    const prompt = runPreToolUseChecks(
      createInput({
        permissionMode: 'ask',
        toolName: 'Write',
        input: { file_path: probeFile, content: 'denied' },
      }),
    );
    expect(prompt.type).toBe('prompt');
    expect(existsSync(probeFile)).toBe(false);
  });
});
