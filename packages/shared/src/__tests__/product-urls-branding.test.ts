import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getDocUrl } from '../docs/doc-links.ts';
import { PRODUCT_DOCS_URL, PRODUCT_VERSIONS_URL } from '../product-identity.ts';

const repoRoot = join(import.meta.dir, '..', '..', '..', '..');

const VAL_BRAND_013_PATHS = [
  'apps/electron/electron-builder.yml',
  'apps/electron/src/main/auto-update.ts',
  'packages/shared/src/docs/doc-links.ts',
  'packages/shared/src/version/manifest.ts',
] as const;

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

describe('VAL-BRAND-013 product URLs', () => {
  it('doc and version base URLs do not reference craft.do', () => {
    expect(PRODUCT_DOCS_URL).not.toMatch(/craft\.do/);
    expect(PRODUCT_VERSIONS_URL).not.toMatch(/craft\.do/);
    expect(getDocUrl('sources')).toBe(`${PRODUCT_DOCS_URL}/sources/overview`);
  });

  it('grep contract files contain no product-facing craft.do URLs', () => {
    for (const relativePath of VAL_BRAND_013_PATHS) {
      const content = readRepoFile(relativePath);
      expect(content).not.toMatch(/https?:\/\/[^'"\s]*craft\.do/);
      expect(content).not.toMatch(/agents\.craft\.do/);
    }
  });
});
