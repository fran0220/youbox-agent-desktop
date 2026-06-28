import { describe, it, expect } from 'bun:test';
import {
  buildPostToolUseAuditEvent,
  buildPreToolUseAuditEvent,
} from '../audit-helpers.ts';

describe('audit-helpers', () => {
  it('builds file write execute audit', () => {
    const ev = buildPreToolUseAuditEvent({
      toolName: 'Write',
      input: { file_path: '/tmp/ocn-probe.txt' },
      permissionMode: 'allow-all',
      checkResult: { type: 'allow' },
    });
    expect(ev).not.toBeNull();
    expect(ev!.action).toBe('tool_allow_all_auto');
    expect(ev!.resource_id).toBe('/tmp/ocn-probe.txt');
  });

  it('builds bash blocked audit', () => {
    const ev = buildPreToolUseAuditEvent({
      toolName: 'Bash',
      input: { command: 'touch x' },
      permissionMode: 'safe',
      checkResult: { type: 'block', reason: 'blocked in safe mode' },
    });
    expect(ev!.action).toBe('tool_blocked');
    expect(ev!.resource_id).toContain('touch x');
  });

  it('builds MCP execute audit', () => {
    const ev = buildPreToolUseAuditEvent({
      toolName: 'mcp__github__create_issue',
      input: {},
      permissionMode: 'ask',
      checkResult: { type: 'allow' },
    });
    expect(ev!.action).toBe('tool_execute');
    expect(ev!.resource_type).toBe('mcp');
  });

  it('builds post-tool failure audit', () => {
    const ev = buildPostToolUseAuditEvent('Bash', { command: 'false' }, true);
    expect(ev.action).toBe('tool_failure');
    expect(ev.resource_id).toContain('outcome=failure');
  });
});
