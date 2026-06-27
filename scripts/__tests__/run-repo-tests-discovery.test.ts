import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dir, '../..');

describe('run-repo-tests discovery', () => {
  it('does not include packaged Electron release output', () => {
    const result = spawnSync(
      'bash',
      [
        '-c',
        `find packages apps scripts -type f \\( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' \\) ! -path '*/node_modules/*' ! -path 'apps/electron/release/*' ! -path 'apps/electron/dist/*' ! -path '*/dist/*'`,
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n').filter(Boolean);
    const releaseHits = lines.filter((l) => l.includes('/release/') || l.includes('electron/release'));
    expect(releaseHits).toEqual([]);
    const ipc = lines.filter((l) => l.endsWith('ipc-channels.test.ts'));
    expect(ipc).toEqual(['apps/electron/src/shared/__tests__/ipc-channels.test.ts']);
  });
});
