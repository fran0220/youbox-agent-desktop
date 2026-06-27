import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { readJsonFileSync } from '@craft-agent/shared/utils/files'
import { mainLog } from './logger'
import { join } from 'path'
import { getConfigDir } from '@craft-agent/shared/config'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface SavedWindow {
  type: 'main'
  workspaceId: string
  bounds: WindowBounds
  focused?: boolean
  // Full URL captured from webContents.getURL() at quit time.
  // May be localhost (dev) or file:// (prod) — both are safe to store because
  // createWindow() never loads this URL directly. It extracts query params
  // (workspaceId, route, focused, etc.) and rebuilds the URL from __dirname
  // (prod) or the current dev server (dev). See window-manager.ts restoreUrl.
  url?: string
}

export interface WindowState {
  windows: SavedWindow[]
  lastFocusedWorkspaceId?: string
}

const windowStateFile = () => join(getConfigDir(), 'window-state.json')

/**
 * Save the current window state (windows with bounds and type)
 */
export function saveWindowState(state: WindowState): void {
  try {
    // Ensure config directory exists
    const configDir = getConfigDir()
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }

    writeFileSync(windowStateFile(), JSON.stringify(state, null, 2), 'utf-8')
    mainLog.info('[WindowState] Saved window state:', state.windows.length, 'windows')
  } catch (error) {
    mainLog.error('[WindowState] Failed to save window state:', error)
  }
}

/**
 * Load the saved window state
 */
export function loadWindowState(): WindowState | null {
  try {
    const statePath = windowStateFile()
    if (!existsSync(statePath)) {
      return null
    }

    const raw = readJsonFileSync(statePath)

    // Validate format
    const state = raw as WindowState
    if (!Array.isArray(state.windows)) {
      mainLog.warn('[WindowState] Invalid window state file, ignoring')
      return null
    }

    mainLog.info('[WindowState] Loaded window state:', state.windows.length, 'windows')
    return state
  } catch (error) {
    mainLog.error('[WindowState] Failed to load window state:', error)
    return null
  }
}

/**
 * Clear the saved window state
 */
export function clearWindowState(): void {
  try {
    const statePath = windowStateFile()
    if (existsSync(statePath)) {
      writeFileSync(statePath, JSON.stringify({ windows: [] }, null, 2), 'utf-8')
      mainLog.info('[WindowState] Cleared window state')
    }
  } catch (error) {
    mainLog.error('[WindowState] Failed to clear window state:', error)
  }
}
