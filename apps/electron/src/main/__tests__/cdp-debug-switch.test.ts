/**
 * Regression guard for CRAFT_REMOTE_DEBUG_PORT → remote-debugging-port switch.
 * Must be registered before app.whenReady() (architecture.md §4.4).
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const INDEX_PATH = join(import.meta.dir, '..', 'index.ts')

describe('cdp-debug-switch bootstrap', () => {
  it('gates remote-debugging-port on CRAFT_REMOTE_DEBUG_PORT before app.whenReady', () => {
    const src = readFileSync(INDEX_PATH, 'utf8')
    const whenReadyIdx = src.indexOf('app.whenReady().then')
    expect(whenReadyIdx).toBeGreaterThan(0)

    const gateIdx = src.indexOf('CRAFT_REMOTE_DEBUG_PORT')
    expect(gateIdx).toBeGreaterThan(0)
    expect(gateIdx).toBeLessThan(whenReadyIdx)

    expect(src).toContain("app.commandLine.appendSwitch('remote-debugging-port', process.env.CRAFT_REMOTE_DEBUG_PORT)")
  })
})
