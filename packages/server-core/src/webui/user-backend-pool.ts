import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { generateServerToken } from '../bootstrap/headless-start'
import type { PlatformServices } from '../runtime/platform'

export const DEFAULT_BACKEND_PORT_MIN = 9101
export const DEFAULT_BACKEND_PORT_MAX = 9120

export function sanitizeUserIdForPath(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 128) || 'user'
}

export function buildUserConfigDir(baseConfigDir: string, userId: string): string {
  return join(baseConfigDir, sanitizeUserIdForPath(userId))
}

export function allocateBackendPort(
  used: Set<number>,
  portMin = DEFAULT_BACKEND_PORT_MIN,
  portMax = DEFAULT_BACKEND_PORT_MAX,
): number {
  for (let port = portMin; port <= portMax; port++) {
    if (!used.has(port)) return port
  }
  throw new Error(`No free backend port in range ${portMin}-${portMax}`)
}

export interface SpawnBackendSpec {
  port: number
  configDir: string
  serverToken: string
  gatewayToken: string
  env: Record<string, string>
}

export interface SpawnedBackendHandle {
  pid: number
  port: number
  stop: () => Promise<void>
}

export interface UserBackendRecord {
  userId: string
  port: number
  pid: number
  configDir: string
  gatewayToken: string
  stop: () => Promise<void>
}

export interface UserBackendPoolOptions {
  baseConfigDir: string
  portMin?: number
  portMax?: number
  jwtSecret: string
  repoRoot: string
  serverEntry: string
  webuiDir: string
  bundledAssetsRoot: string
  gatewayBaseUrl: string
  spawnBackend?: (spec: SpawnBackendSpec) => Promise<SpawnedBackendHandle>
  waitForHealthy?: (port: number) => Promise<boolean>
  logger: PlatformServices['logger']
}

export class UserBackendPool {
  private readonly backends = new Map<string, UserBackendRecord>()
  private readonly usedPorts = new Set<number>()
  private readonly options: UserBackendPoolOptions

  constructor(options: UserBackendPoolOptions) {
    this.options = options
    mkdirSync(options.baseConfigDir, { recursive: true })
  }

  getBackendForUser(userId: string): UserBackendRecord | null {
    return this.backends.get(userId) ?? null
  }

  async ensureBackend(userId: string, gatewayToken: string): Promise<UserBackendRecord> {
    const existing = this.backends.get(userId)
    if (existing && existing.gatewayToken === gatewayToken) {
      return existing
    }
    if (existing) {
      await this.releaseBackend(userId)
    }

    const port = allocateBackendPort(
      this.usedPorts,
      this.options.portMin ?? DEFAULT_BACKEND_PORT_MIN,
      this.options.portMax ?? DEFAULT_BACKEND_PORT_MAX,
    )
    const configDir = buildUserConfigDir(this.options.baseConfigDir, userId)
    mkdirSync(configDir, { recursive: true })
    const serverToken = generateServerToken()

    const env: Record<string, string> = {
      CRAFT_CONFIG_DIR: configDir,
      CRAFT_RPC_HOST: '127.0.0.1',
      CRAFT_RPC_PORT: String(port),
      CRAFT_SERVER_TOKEN: serverToken,
      CRAFT_WEBUI_DIR: this.options.webuiDir,
      CRAFT_BUNDLED_ASSETS_ROOT: this.options.bundledAssetsRoot,
      CRAFT_REPO_ROOT: this.options.repoRoot,
      CRAFT_GATEWAY_SESSION_TOKEN: gatewayToken,
      ORIGINCOWORKS_GATEWAY_URL: this.options.gatewayBaseUrl,
      CRAFT_WEBUI_JWT_SECRET: this.options.jwtSecret,
    }

    const spawn = this.options.spawnBackend ?? defaultSpawnBackend
    const handle = await spawn({
      port,
      configDir,
      serverToken,
      gatewayToken,
      env,
    })

    const wait = this.options.waitForHealthy ?? defaultWaitForHealthy
    const healthy = await wait(port)
    if (!healthy) {
      await handle.stop()
      throw new Error(`User backend on port ${port} failed health check`)
    }

    const record: UserBackendRecord = {
      userId,
      port,
      pid: handle.pid,
      configDir,
      gatewayToken,
      stop: handle.stop,
    }
    this.backends.set(userId, record)
    this.usedPorts.add(port)
    this.options.logger.info(`[webui] Spawned backend for user ${userId} on port ${port} (pid ${handle.pid})`)
    return record
  }

  async releaseBackend(userId: string): Promise<void> {
    const record = this.backends.get(userId)
    if (!record) return
    this.backends.delete(userId)
    this.usedPorts.delete(record.port)
    try {
      await record.stop()
      this.options.logger.info(`[webui] Stopped backend for user ${userId} (port ${record.port})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.options.logger.warn(`[webui] Error stopping backend for ${userId}: ${msg}`)
    }
  }

  async dispose(): Promise<void> {
    const userIds = [...this.backends.keys()]
    for (const userId of userIds) {
      await this.releaseBackend(userId)
    }
  }
}

async function defaultSpawnBackend(spec: SpawnBackendSpec): Promise<SpawnedBackendHandle> {
  const { spawnBackendProcess } = await import('./spawn-user-backend')
  return spawnBackendProcess(spec)
}

async function defaultWaitForHealthy(port: number): Promise<boolean> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    try {
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) return true
    } catch {
      // retry
    }
    await Bun.sleep(250)
  }
  return false
}
