import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  getInstanceConfigDir,
  stripCraftDataDirWorkspacePath,
} from '../paths.ts';

describe('data directory names', () => {
  test('uses OriginAI default and keeps legacy alias name', () => {
    expect(DEFAULT_DATA_DIR_NAME).toBe('.originai');
    expect(LEGACY_DATA_DIR_NAME).toBe('.origincoworks-next');
  });
});

describe('getInstanceConfigDir', () => {
  test('derives numbered instance dir from default data dir name', () => {
    expect(getInstanceConfigDir('1')).toMatch(
      new RegExp(`${DEFAULT_DATA_DIR_NAME.replace('.', '\\.')}-1$`)
    );
    expect(getInstanceConfigDir('2')).toMatch(
      new RegExp(`${DEFAULT_DATA_DIR_NAME.replace('.', '\\.')}-2$`)
    );
  });
});

describe('stripCraftDataDirWorkspacePath', () => {
  test('shortens paths under the canonical data directory', () => {
    const base = `/Users/alice/${DEFAULT_DATA_DIR_NAME}`;
    const full = `${base}/workspaces/ws-1/sessions/sess-1/plans/foo.md`;
    expect(stripCraftDataDirWorkspacePath(full)).toBe('plans/foo.md');
  });

  test('shortens workspace-only paths without session segment', () => {
    const base = `/Users/alice/${DEFAULT_DATA_DIR_NAME}`;
    const full = `${base}/workspaces/ws-1/notes/readme.md`;
    expect(stripCraftDataDirWorkspacePath(full)).toBe('notes/readme.md');
  });

  test('normalizes backslashes before stripping', () => {
    const base = `C:\\Users\\alice\\${DEFAULT_DATA_DIR_NAME}`;
    const full = `${base}\\workspaces\\ws-1\\sessions\\sess-1\\file.txt`;
    expect(stripCraftDataDirWorkspacePath(full)).toBe('file.txt');
  });

  test('leaves unrelated paths unchanged', () => {
    const path = '/tmp/other/plans/foo.md';
    expect(stripCraftDataDirWorkspacePath(path)).toBe(path);
  });
});
