import { describe, it, expect, beforeEach } from 'bun:test';
import { GatewayClient } from '../gateway-client.ts';
import { postAuditEvent, sanitizeAuditResourceId } from '../audit.ts';

describe('audit.ts', () => {
  beforeEach(() => {
    GatewayClient.setFetchForTests(undefined);
  });

  it('sanitizeAuditResourceId redacts sk- keys', () => {
    const out = sanitizeAuditResourceId('run with sk-abc1234567890xyz');
    expect(out).not.toContain('sk-abc');
    expect(out).toContain('[REDACTED]');
  });

  it('postAuditEvent calls POST /api/desktop/audit', async () => {
    let captured: { path: string; body: unknown } | null = null;
    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input);
      if (!url.includes('/api/desktop/audit')) {
        return new Response('not found', { status: 404 });
      }
      captured = {
        path: url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      return new Response('', { status: 204 });
    });
    await postAuditEvent('http://127.0.0.1:8847', 'a'.repeat(64), {
      action: 'tool_bash',
      resource_type: 'bash',
      resource_id: 'echo hi',
    });
    expect(captured).not.toBeNull();
    expect((captured!.body as { action: string }).action).toBe('tool_bash');
  });
});
