/**
 * VAL-PERM-009: PiAgent must honor session "always allow" like ClaudeAgent.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { PiAgent } from '../pi-agent.ts';
import type { BackendConfig } from '../backend/types.ts';
import { cleanupModeState } from '../mode-manager.ts';

const SESSION_ID = 'pi-always-allow-session';

function createConfig(): BackendConfig {
  return {
    provider: 'pi',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: '/tmp/ws-root',
    } as BackendConfig['workspace'],
    session: {
      id: SESSION_ID,
      workspaceRootPath: '/tmp/ws-root',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      workingDirectory: '/tmp/ws-root',
    } as BackendConfig['session'],
    isHeadless: true,
  };
}

describe('PiAgent respondToPermission always-allow', () => {
  afterEach(() => {
    cleanupModeState(SESSION_ID);
  });

  it('whitelists base command when alwaysAllow is true', () => {
    const agent = new PiAgent(createConfig());
    const pm = (agent as unknown as { permissionManager: { isCommandWhitelisted: (c: string) => boolean } })
      .permissionManager;

    const requestId = 'test-req-1';
    const pending = (agent as unknown as {
      pendingPermissions: Map<
        string,
        { resolve: (a: boolean) => void; toolName: string; command: string; baseCommand: string }
      >;
    }).pendingPermissions;

    let resolved = false;
    pending.set(requestId, {
      resolve: (allowed) => {
        resolved = allowed;
      },
      toolName: 'Bash',
      command: 'echo hello',
      baseCommand: 'echo',
    });

    expect(pm.isCommandWhitelisted('echo')).toBe(false);
    agent.respondToPermission(requestId, true, true);
    expect(resolved).toBe(true);
    expect(pm.isCommandWhitelisted('echo')).toBe(true);

    agent.destroy();
  });

  it('does not whitelist when user denies', () => {
    const agent = new PiAgent(createConfig());
    const pm = (agent as unknown as { permissionManager: { isCommandWhitelisted: (c: string) => boolean } })
      .permissionManager;

    const requestId = 'test-req-2';
    const pending = (agent as unknown as {
      pendingPermissions: Map<
        string,
        { resolve: (a: boolean) => void; toolName: string; command: string; baseCommand: string }
      >;
    }).pendingPermissions;

    pending.set(requestId, {
      resolve: () => {},
      toolName: 'Bash',
      command: 'echo hello',
      baseCommand: 'echo',
    });

    agent.respondToPermission(requestId, false, true);
    expect(pm.isCommandWhitelisted('echo')).toBe(false);

    agent.destroy();
  });
});
