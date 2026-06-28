import { describe, expect, it } from 'bun:test'
import {
  allocateBackendPort,
  buildUserConfigDir,
  UserBackendPool,
  type UserBackendPoolOptions,
} from './user-backend-pool'

describe('user-backend pool helpers', () => {
  it('allocateBackendPort assigns distinct ports in 9101-9120', () => {
    const used = new Set<number>()
    const a = allocateBackendPort(used)
    used.add(a)
    const b = allocateBackendPort(used)
    expect(a).toBeGreaterThanOrEqual(9101)
    expect(a).toBeLessThanOrEqual(9120)
    expect(b).toBeGreaterThanOrEqual(9101)
    expect(b).toBeLessThanOrEqual(9120)
    expect(a).not.toBe(b)
  })

  it('allocateBackendPort throws when range exhausted', () => {
    const used = new Set<number>()
    for (let p = 9101; p <= 9120; p++) used.add(p)
    expect(() => allocateBackendPort(used)).toThrow(/no free backend port/i)
  })

  it('buildUserConfigDir nests under base and sanitizes user id', () => {
    const dir = buildUserConfigDir('/tmp/ocn-webui', 'user/abc:1')
    expect(dir).toBe('/tmp/ocn-webui/user_abc_1')
  })
})

describe('UserBackendPool', () => {
  it('tracks userId to port mapping and releases port on release', async () => {
    let killedPid: number | null = null
    const options: UserBackendPoolOptions = {
      baseConfigDir: '/tmp/test-webui-users',
      portMin: 9101,
      portMax: 9103,
      jwtSecret: 'jwt-secret-test-value-32chars!!',
      repoRoot: '/repo',
      serverEntry: '/repo/packages/server/src/index.ts',
      webuiDir: '/repo/apps/webui/dist',
      bundledAssetsRoot: '/repo/apps/electron',
      gatewayBaseUrl: 'http://127.0.0.1:8847',
      spawnBackend: async (spec) => {
        const proc = { pid: 1000 + spec.port, kill: () => { killedPid = 1000 + spec.port } }
        return { pid: proc.pid, port: spec.port, stop: async () => { proc.kill() } }
      },
      waitForHealthy: async () => true,
      logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
    }

    const pool = new UserBackendPool(options)
    const tokenA = 'a'.repeat(64)
    const tokenB = 'b'.repeat(64)
    const first = await pool.ensureBackend('user-a', tokenA)
    const second = await pool.ensureBackend('user-b', tokenB)
    expect(first.port).not.toBe(second.port)
    expect(pool.getBackendForUser('user-a')?.port).toBe(first.port)

    await pool.releaseBackend('user-a')
    expect(pool.getBackendForUser('user-a')).toBeNull()
    expect(killedPid === first.pid).toBe(true)
    expect(pool.getBackendForUser('user-b')?.port).toBe(second.port)
  })
})
