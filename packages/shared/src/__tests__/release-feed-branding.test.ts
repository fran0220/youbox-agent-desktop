import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..', '..', '..', '..');

describe('VAL-RELEASE-007 updater feed config', () => {
  it('electron-builder publish and auto-update reference gateway release feed', () => {
    const yml = readFileSync(join(repoRoot, 'apps/electron/electron-builder.yml'), 'utf-8');
    expect(yml).toMatch(/\/api\/desktop\/release\//);
    expect(yml).not.toMatch(/agents\.craft\.do/);

    const autoUpdate = readFileSync(join(repoRoot, 'apps/electron/src/main/auto-update.ts'), 'utf-8');
    expect(autoUpdate).toMatch(/resolveGatewayUpdaterFeedBaseUrl/);
    expect(autoUpdate).toMatch(/setFeedURL/);
    expect(autoUpdate).toMatch(/\/api\/desktop\/release/);
  });
});
