import { describe, test, expect } from 'bun:test';
import { validateSourceConfig } from '../../config/validators.ts';
import { getBuiltinSources, isBuiltinSource } from '../builtin-sources.ts';
import { getMemoryBuiltinSource, MEMORY_SOURCE_SLUG, isMemorySourceSlug } from '../memory-source.ts';
import { isSourceUsable } from '../storage.ts';
import { SourceServerBuilder } from '../server-builder.ts';
import type { FolderSourceConfig } from '../types.ts';

describe('memory SourceType', () => {
  test('MEMORY_SOURCE_SLUG is memory', () => {
    expect(MEMORY_SOURCE_SLUG).toBe('memory');
    expect(isMemorySourceSlug('memory')).toBe(true);
    expect(isMemorySourceSlug('linear')).toBe(false);
  });

  test('builtin memory source has type memory and is usable', () => {
    const source = getMemoryBuiltinSource('ws-1', '/tmp/ws');
    expect(source.config.type).toBe('memory');
    expect(source.config.slug).toBe('memory');
    expect(source.isBuiltin).toBe(true);
    expect(isSourceUsable(source)).toBe(true);
  });

  test('getBuiltinSources includes memory', () => {
    const builtins = getBuiltinSources('ws-1', '/tmp/ws');
    expect(builtins.some((s) => s.config.slug === 'memory')).toBe(true);
    expect(isBuiltinSource('memory')).toBe(true);
  });

  test('validateSourceConfig accepts memory type without mcp/api/local block', () => {
    const config: FolderSourceConfig = {
      id: 'mem-1',
      name: 'Memory',
      slug: 'memory',
      enabled: true,
      provider: 'origincoworks',
      type: 'memory',
    };
    const result = validateSourceConfig(config);
    expect(result.valid).toBe(true);
  });

  test('validateSourceConfig still accepts mcp source', () => {
    const config: FolderSourceConfig = {
      id: 'mcp-1',
      name: 'Test MCP',
      slug: 'test-mcp',
      enabled: true,
      provider: 'test',
      type: 'mcp',
      mcp: { url: 'https://example.com/mcp', authType: 'none' },
    };
    expect(validateSourceConfig(config).valid).toBe(true);
  });

  test('SourceServerBuilder.buildAll skips memory without errors', async () => {
    const builder = new SourceServerBuilder();
    const memory = getMemoryBuiltinSource('ws', '/tmp/ws');
    const { mcpServers, apiServers, errors } = await builder.buildAll([
      { source: memory, token: null, credential: null },
    ]);
    expect(Object.keys(mcpServers)).toHaveLength(0);
    expect(Object.keys(apiServers)).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
