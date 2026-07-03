import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const INDEX_PATH = join(import.meta.dir, '..', 'index.ts')
const DESIGN_PROTOCOL_PATH = join(import.meta.dir, '..', 'design-protocol.ts')
const RESOLVER_PATH = join(import.meta.dir, '..', 'design-protocol-resolver.ts')

describe('design protocol wiring', () => {
  it('keeps resolver electron-free', () => {
    expect(existsSync(RESOLVER_PATH)).toBe(true)
    const src = readFileSync(RESOLVER_PATH, 'utf8')

    expect(src).not.toContain("from 'electron'")
    expect(src).not.toContain('from "electron"')
  })

  it('registers the design scheme with required privileges', () => {
    expect(existsSync(DESIGN_PROTOCOL_PATH)).toBe(true)
    const src = readFileSync(DESIGN_PROTOCOL_PATH, 'utf8')

    expect(src).toContain('registerDesignScheme')
    expect(src).toContain('protocol.registerSchemesAsPrivileged')
    expect(src).toContain("scheme: 'design'")
    expect(src).toContain('standard: true')
    expect(src).toContain('supportFetchAPI: true')
    expect(src).toContain('corsEnabled: true')
    expect(src).toContain('stream: true')
  })

  it('registers the design scheme before app.whenReady', () => {
    const src = readFileSync(INDEX_PATH, 'utf8')
    const whenReadyIdx = src.indexOf('app.whenReady().then')
    expect(whenReadyIdx).toBeGreaterThan(0)

    const registerIdx = src.indexOf('registerDesignScheme()')
    expect(registerIdx).toBeGreaterThan(0)
    expect(registerIdx).toBeLessThan(whenReadyIdx)
  })

  it('keeps the Electron wrapper thin and delegates resolution', () => {
    const src = readFileSync(DESIGN_PROTOCOL_PATH, 'utf8')

    expect(src).toContain("import { resolveDesignRequest")
    expect(src).toContain("protocol.handle('design'")
    expect(src).toContain('resolveDesignRequest(')
    expect(src).not.toContain('realpath')
    expect(src).not.toContain('decodeURIComponent')
    expect(src).not.toContain("join(workspaceRoot")
  })
})
