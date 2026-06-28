import { afterAll, describe, expect, it } from 'bun:test';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  adaptLegacyMessage,
  adaptLegacyMessages,
  buildStoredSessionFromClassic,
  materializeImportedSession,
} from '../session-import.ts';
import type { ClassicChatSession } from '../types.ts';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'ocn-import-'));

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('session-import adapter', () => {
  it('adaptLegacyMessage maps user and assistant roles', () => {
    const user = adaptLegacyMessage('sess-1', 0, { role: 'user', content: 'Hello' });
    const assistant = adaptLegacyMessage('sess-1', 1, { role: 'assistant', content: 'Hi there' });
    expect(user?.type).toBe('user');
    expect(user?.content).toBe('Hello');
    expect(assistant?.type).toBe('assistant');
    expect(assistant?.content).toBe('Hi there');
  });

  it('adaptLegacyMessages preserves chronological order', () => {
    const messages = adaptLegacyMessages('s1', [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ]);
    expect(messages.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });

  it('buildStoredSessionFromClassic sets provenance and imported status', () => {
    const classic: ClassicChatSession = {
      id: 'legacy-abc',
      title: 'Old chat',
      type: 'chat',
      model: 'gpt-5.5',
      workspace_path: '/tmp/ws',
      messages: [{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    };
    const stored = buildStoredSessionFromClassic(workspaceRoot, classic);
    expect(stored.importedFrom).toBe('gateway:chat_sessions');
    expect(stored.sessionStatus).toBe('imported');
    expect(stored.labels).toContain('imported');
    expect(stored.messages).toHaveLength(2);
    expect(stored.name).toBe('Old chat');
  });

  it('adaptLegacyMessage maps tool role with tool_input and result', () => {
    const tool = adaptLegacyMessage('s1', 0, {
      role: 'tool',
      name: 'Bash',
      tool_call_id: 'call-1',
      tool_input: { command: 'ls' },
      content: 'file.txt',
    });
    expect(tool?.type).toBe('tool');
    expect(tool?.toolName).toBe('Bash');
    expect(tool?.toolUseId).toBe('call-1');
    expect(tool?.toolInput).toEqual({ command: 'ls' });
    expect(tool?.content).toBe('file.txt');
    expect(tool?.toolStatus).toBe('completed');
  });

  it('adaptLegacyMessage preserves attachment and tool_call markers on assistant turns', () => {
    const msg = adaptLegacyMessage('s1', 0, {
      role: 'assistant',
      content: 'Here is the file',
      attachments: [{ type: 'image', name: 'scan.png', mime_type: 'image/png' }],
      tool_calls: [{ function: { name: 'Read' } }],
    } as ClassicChatSession['messages'][number]);
    expect(msg?.content).toContain('Here is the file');
    expect(msg?.content).toContain('[attachment: scan.png (image/png)]');
    expect(msg?.content).toContain('[tool_call: Read]');
  });

  it('adaptLegacyMessages skips malformed elements and keeps valid messages', () => {
    const messages = adaptLegacyMessages('s1', [
      { role: 'user', content: 'ok' },
      null as unknown as ClassicChatSession['messages'][number],
      { role: 'bogus' } as ClassicChatSession['messages'][number],
      { role: 'assistant', content: 'reply' },
    ]);
    expect(messages.map((m) => m.content)).toEqual(['ok', 'reply']);
  });

  it('adaptLegacyMessages handles large transcripts without dropping order', () => {
    const legacy = Array.from({ length: 500 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `line-${i}`,
    }));
    const messages = adaptLegacyMessages('long-sess', legacy);
    expect(messages).toHaveLength(500);
    expect(messages[0]?.content).toBe('line-0');
    expect(messages[499]?.content).toBe('line-499');
  });

  it('materializeImportedSession writes session.jsonl once (idempotent)', () => {
    const classic: ClassicChatSession = {
      id: '250101-test-1',
      title: 'Once',
      type: 'chat',
      model: 'gpt-5.5',
      workspace_path: '',
      messages: [{ role: 'user', content: 'only' }],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };
    const first = materializeImportedSession(workspaceRoot, classic);
    expect(first.action).toBe('created');
    const second = materializeImportedSession(workspaceRoot, classic);
    expect(second.action).toBe('skipped');
    const jsonl = readFileSync(
      join(workspaceRoot, 'sessions', classic.id, 'session.jsonl'),
      'utf8',
    );
    const lines = jsonl.trim().split('\n');
    expect(lines.length).toBe(2);
    const header = JSON.parse(lines[0]!) as { importedFrom?: string; sessionStatus?: string };
    expect(header.importedFrom).toBe('gateway:chat_sessions');
    expect(header.sessionStatus).toBe('imported');
  });
});
