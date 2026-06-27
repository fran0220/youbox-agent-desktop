/**
 * Centralized path configuration for Craft Agent / OriginCoworks Next.
 *
 * Supports multi-instance development via CRAFT_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., craft-tui-agent-1), the detect-instance.sh
 * script sets CRAFT_CONFIG_DIR to ~/.origincoworks-next-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.origincoworks-next/
 * Instance 1 (-1 suffix): ~/.origincoworks-next-1/
 * Instance 2 (-2 suffix): ~/.origincoworks-next-2/
 */

import { homedir } from 'os';
import { join } from 'path';

import { DEFAULT_DATA_DIR_NAME, stripCraftDataDirWorkspacePath } from './path-display.ts';
export { DEFAULT_DATA_DIR_NAME, stripCraftDataDirWorkspacePath };

/**
 * Resolve the active data directory (honors CRAFT_CONFIG_DIR at call time).
 */
export function getConfigDir(): string {
  return process.env.CRAFT_CONFIG_DIR || join(homedir(), DEFAULT_DATA_DIR_NAME);
}

/**
 * Per-user data directory for a numbered dev instance (e.g. repo folder suffix `-1`).
 * Matches multi-instance layout: ~/.origincoworks-next-1, ~/.origincoworks-next-2, ...
 */
export function getInstanceConfigDir(instanceNumber: string): string {
  return join(homedir(), `${DEFAULT_DATA_DIR_NAME}-${instanceNumber}`);
}

// Resolved at module load; prefer getConfigDir() when env may be set after import (tests).
export const CONFIG_DIR = getConfigDir();
