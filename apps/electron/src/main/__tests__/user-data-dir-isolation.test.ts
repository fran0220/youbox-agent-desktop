import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const INDEX_PATH = join(import.meta.dir, '..', 'index.ts')

describe('user data dir isolation bootstrap', () => {
  it('applies CRAFT_USER_DATA_DIR before single-instance lock and app name setup', () => {
    const src = readFileSync(INDEX_PATH, 'utf8')

    const envIdx = src.indexOf('CRAFT_USER_DATA_DIR')
    const userDataIdx = src.indexOf("app.setPath('userData', customUserDataDir)")
    const sessionDataIdx = src.indexOf("app.setPath('sessionData', customUserDataDir)")
    const setNameIdx = src.indexOf('app.setName(')
    const lockIdx = src.indexOf('app.requestSingleInstanceLock()')

    expect(envIdx).toBeGreaterThan(0)
    expect(userDataIdx).toBeGreaterThan(envIdx)
    expect(sessionDataIdx).toBeGreaterThan(userDataIdx)
    expect(userDataIdx).toBeLessThan(setNameIdx)
    expect(userDataIdx).toBeLessThan(lockIdx)
  })
})
