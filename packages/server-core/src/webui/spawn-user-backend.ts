import { dirname, join } from 'node:path'
import type { SpawnBackendSpec, SpawnedBackendHandle } from './user-backend-pool'

/**
 * Spawn a headless server subprocess for one gateway user (no WebUI front-controller flag).
 */
export async function spawnBackendProcess(
  spec: SpawnBackendSpec,
  serverEntry?: string,
): Promise<SpawnedBackendHandle> {
  const resolvedRepo = process.env.CRAFT_REPO_ROOT
    ?? (spec.env.CRAFT_BUNDLED_ASSETS_ROOT
      ? dirname(dirname(spec.env.CRAFT_BUNDLED_ASSETS_ROOT))
      : process.cwd())
  const entry = serverEntry ?? process.env.CRAFT_SERVER_ENTRY
    ?? join(resolvedRepo, 'packages/server/src/index.ts')

  const proc = Bun.spawn({
    cmd: ['bun', 'run', entry],
    cwd: resolvedRepo,
    env: {
      ...process.env,
      ...spec.env,
      CRAFT_WEBUI_FRONT_CONTROLLER: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const pid = proc.pid
  if (!pid) {
    throw new Error('Failed to spawn user backend process')
  }

  return {
    pid,
    port: spec.port,
    stop: async () => {
      try {
        proc.kill()
      } catch {
        // already dead
      }
      await proc.exited.catch(() => undefined)
    },
  }
}
