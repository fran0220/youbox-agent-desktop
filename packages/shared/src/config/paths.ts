/**
 * Centralized path configuration for Craft Agent / OriginAI.
 *
 * Supports multi-instance development via CRAFT_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., craft-tui-agent-1), the detect-instance.sh
 * script sets CRAFT_CONFIG_DIR to ~/.originai-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.originai/
 * Instance 1 (-1 suffix): ~/.originai-1/
 * Instance 2 (-2 suffix): ~/.originai-2/
 *
 * Legacy ~/.origincoworks-next is used as a read fallback when ~/.originai does not exist.
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import {
  DEFAULT_DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  stripCraftDataDirWorkspacePath,
} from './path-display.ts';
export { DEFAULT_DATA_DIR_NAME, LEGACY_DATA_DIR_NAME, stripCraftDataDirWorkspacePath };

/**
 * Resolve the active data directory (honors CRAFT_CONFIG_DIR at call time).
 * New installs use ~/.originai; existing installs keep ~/.origincoworks-next until migrated.
 */
export function getConfigDir(): string {
  if (process.env.CRAFT_CONFIG_DIR) {
    return process.env.CRAFT_CONFIG_DIR;
  }
  const newDir = join(homedir(), DEFAULT_DATA_DIR_NAME);
  const legacyDir = join(homedir(), LEGACY_DATA_DIR_NAME);
  if (!existsSync(newDir) && existsSync(legacyDir)) {
    return legacyDir;
  }
  return newDir;
}

/**
 * Per-user data directory for a numbered dev instance (e.g. repo folder suffix `-1`).
 * Matches multi-instance layout: ~/.originai-1, ~/.originai-2, ...
 */
export function getInstanceConfigDir(instanceNumber: string): string {
  return join(homedir(), `${DEFAULT_DATA_DIR_NAME}-${instanceNumber}`);
}

// Resolved at module load; prefer getConfigDir() when env may be set after import (tests).
export const CONFIG_DIR = getConfigDir();