import { describe, expect, it } from 'bun:test';
import {
  formatSkippedRequiredSourcesWarning,
  resolveRequiredSourceEnables,
} from '../required-sources.ts';

describe('resolveRequiredSourceEnables', () => {
  it('enables usable sources not already on the session', () => {
    const result = resolveRequiredSourceEnables({
      requiredSlugs: ['github', 'slack'],
      currentEnabledSlugs: ['github'],
      usableSlugs: new Set(['github', 'slack']),
    });
    expect(result.toEnable).toEqual(['slack']);
    expect(result.skipped).toEqual([]);
  });

  it('skips missing or unusable sources', () => {
    const result = resolveRequiredSourceEnables({
      requiredSlugs: ['ok-src', 'missing-src'],
      currentEnabledSlugs: [],
      usableSlugs: ['ok-src'],
    });
    expect(result.toEnable).toEqual(['ok-src']);
    expect(result.skipped).toEqual(['missing-src']);
  });

  it('deduplicates required slugs', () => {
    const result = resolveRequiredSourceEnables({
      requiredSlugs: ['a', 'a', ' b '],
      currentEnabledSlugs: [],
      usableSlugs: new Set(['a', 'b']),
    });
    expect(result.toEnable).toEqual(['a', 'b']);
  });
});

describe('formatSkippedRequiredSourcesWarning', () => {
  it('formats skipped slugs for UI', () => {
    expect(formatSkippedRequiredSourcesWarning(['x', 'y'])).toContain('x');
    expect(formatSkippedRequiredSourcesWarning(['x', 'y'])).toContain('y');
    expect(formatSkippedRequiredSourcesWarning([])).toBe('');
  });
});
