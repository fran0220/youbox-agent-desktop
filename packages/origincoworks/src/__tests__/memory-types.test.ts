import { describe, expect, it } from 'bun:test';
import { assertMemorySyncResponse, type MemorySyncResponse } from '../memory-types.ts';

describe('assertMemorySyncResponse', () => {
  it('accepts null pull and push_accepted as empty arrays', () => {
    const raw = {
      pull: null,
      push_accepted: null,
      server_time: '2026-01-01T00:00:00Z',
    };
    expect(() => assertMemorySyncResponse(raw)).not.toThrow();
    const normalized = raw as MemorySyncResponse;
    expect(normalized.pull).toEqual([]);
    expect(normalized.push_accepted).toEqual([]);
  });

  it('accepts undefined pull and push_accepted as empty arrays', () => {
    const raw = {
      server_time: '2026-01-01T00:00:00Z',
    };
    expect(() => assertMemorySyncResponse(raw)).not.toThrow();
    const normalized = raw as MemorySyncResponse;
    expect(normalized.pull).toEqual([]);
    expect(normalized.push_accepted).toEqual([]);
  });

  it('rejects non-array non-null pull', () => {
    expect(() =>
      assertMemorySyncResponse({
        pull: 'bad',
        push_accepted: [],
        server_time: 't',
      }),
    ).toThrow(/pull must be an array/);
  });

  it('rejects non-array non-null push_accepted', () => {
    expect(() =>
      assertMemorySyncResponse({
        pull: [],
        push_accepted: 42,
        server_time: 't',
      }),
    ).toThrow(/push_accepted must be an array/);
  });
});
