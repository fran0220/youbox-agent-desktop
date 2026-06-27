import { describe, expect, it } from 'bun:test';
import { DEFAULT_DATA_DIR_NAME } from '../../packages/shared/src/config/paths.ts';
import { buildDockerComposeYaml } from '../build-server.ts';

describe('build-server docker-compose', () => {
  it('mounts the named volume at the headless server default data directory', () => {
    const yaml = buildDockerComposeYaml();
    const mount = `/root/${DEFAULT_DATA_DIR_NAME}`;

    expect(yaml).toContain(`origincoworks-data:${mount}`);
    expect(yaml).not.toContain('craft-data:/root/.craft-agent');
    expect(yaml).not.toContain('/root/.craft-agent');
  });
});
