import { describe, expect, it } from 'bun:test';
import { groupMessagesByTurn } from '../turn-utils';
import type { Message } from '@craft-agent/core';

function msg(id: string, role: Message['role'], content: string, timestamp: number): Message {
  return { id, role, content, timestamp } as Message;
}

describe('groupMessagesByTurn preserveMessageOrder', () => {
  it('preserves array order when timestamps would sort newest-first', () => {
    const messages = [
      msg('u1', 'user', 'OCTEST-TRANSCRIPT-LINE-1', 3000),
      msg('a1', 'assistant', 'OCTEST-TRANSCRIPT-LINE-2', 2000),
      msg('u2', 'user', 'OCTEST-TRANSCRIPT-LINE-3', 1000),
    ];
    const turns = groupMessagesByTurn(messages, { preserveMessageOrder: true });
    expect(turns.map((t) => (t.type === 'user' ? t.message.content : t.response?.text))).toEqual([
      'OCTEST-TRANSCRIPT-LINE-1',
      'OCTEST-TRANSCRIPT-LINE-2',
      'OCTEST-TRANSCRIPT-LINE-3',
    ]);
  });

  it('renders all turns for a long imported-style transcript (no truncation at grouping)', () => {
    const messages: Message[] = [];
    for (let i = 0; i < 400; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      messages.push(
        msg(`m-${i}`, role, `OCTEST-LONG-MSG-${String(i + 1).padStart(4, '0')}`, 1_000_000 + i),
      );
    }
    const turns = groupMessagesByTurn(messages, { preserveMessageOrder: true });
    expect(turns).toHaveLength(400);
    expect((turns[0] as { type: 'user'; message: Message }).message.content).toBe('OCTEST-LONG-MSG-0001');
    expect((turns[399] as { type: 'assistant'; response?: { text: string } }).response?.text).toBe(
      'OCTEST-LONG-MSG-0400',
    );
  });
});
