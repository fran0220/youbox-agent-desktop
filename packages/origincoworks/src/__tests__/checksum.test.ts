import { describe, it, expect } from 'bun:test';
import { createHash } from 'crypto';
import { contentChecksum } from '../checksum.ts';

describe('contentChecksum', () => {
  it('matches gateway sha256[:16] (first 8 bytes hex)', () => {
    const content = 'hello skills';
    const expected = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
    expect(contentChecksum(content)).toBe(expected);
    expect(contentChecksum(content)).toHaveLength(16);
  });
});
