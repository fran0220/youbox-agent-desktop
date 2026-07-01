/**
 * Centralized path configuration for YouBox Agent.
 *
 * Supports multi-instance development via YOUBOX_AGENT_CONFIG_DIR or the
 * upstream-compatible CRAFT_CONFIG_DIR environment variable.
 *
 * Default: ~/.youbox-agent/
 */

import { homedir } from 'os';
import { join } from 'path';

// Allow override via environment variable for multi-instance dev. Keep
// CRAFT_CONFIG_DIR as a compatibility escape hatch for upstream scripts while
// using a YouBox-owned default so this fork never writes into Craft's data dir.
export const CONFIG_DIR = process.env.YOUBOX_AGENT_CONFIG_DIR || process.env.CRAFT_CONFIG_DIR || join(homedir(), '.youbox-agent');
