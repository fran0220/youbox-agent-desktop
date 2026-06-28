import { describe, expect, it } from 'bun:test';
import { normalizeMemoryPath, validateMemoryPath } from '../memory-path.ts';

describe('memory-path', () => {
  it('rejects traversal and absolute paths', () => {
    expect(validateMemoryPath('../secret')).toBe(false);
    expect(validateMemoryPath('/etc/passwd')).toBe(false);
    expect(validateMemoryPath('daily/2026-01-01.md')).toBe(true);
  });

  it('normalizes slashes', () => {
    expect(normalizeMemoryPath('\\daily\\log.md')).toBe('daily/log.md');
  });
});
