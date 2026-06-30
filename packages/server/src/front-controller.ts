#!/usr/bin/env bun
/**
 * WebUI front controller (port 9100): gateway login + spawn per-user backends on 9101+.
 *
 *   CRAFT_WEBUI_FRONT_CONTROLLER=1 CRAFT_RPC_PORT=9100 CRAFT_WEBUI_DIR=... bun run packages/server/src/front-controller.ts
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth'
import { getConfigDir } from '@craft-agent/shared/config'
import { generateServerToken } from '@craft-agent/server-core/bootstrap'
import {
  createFrontControllerHandler,
  UserBackendPool,
} from '@craft-agent/server-core/webui'

const webuiDir = process.env.CRAFT_WEBUI_DIR
if (!webuiDir || !existsSync(webuiDir)) {
  console.error('CRAFT_WEBUI_DIR must point at built webui dist/')
  process.exit(1)
}

const listenPort = parseInt(process.env.CRAFT_RPC_PORT ?? '9100', 10)
const host = process.env.CRAFT_RPC_HOST ?? '127.0.0.1'
const jwtSecret = process.env.CRAFT_WEBUI_JWT_SECRET?.trim()
  || process.env.CRAFT_SERVER_TOKEN?.trim()
  || generateServerToken()

const repoRoot = process.env.CRAFT_REPO_ROOT ?? join(import.meta.dir, '..', '..')
const bundledAssetsRoot = process.env.CRAFT_BUNDLED_ASSETS_ROOT ?? join(repoRoot, 'apps', 'electron')
const baseConfigDir = process.env.CRAFT_WEBUI_USERS_DIR
  ?? join(getConfigDir(), 'webui-users')

const logger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: () => {},
} as const

const pool = new UserBackendPool({
  baseConfigDir,
  jwtSecret,
  repoRoot,
  serverEntry: join(repoRoot, 'packages', 'server', 'src', 'index.ts'),
  webuiDir,
  bundledAssetsRoot,
  gatewayBaseUrl: resolveGatewayBaseUrl(),
  logger: logger as any,
})

const handler = createFrontControllerHandler({
  webuiDir,
  secret: jwtSecret,
  pool,
  listenPort,
  logger: logger as any,
  getHealthCheck: () => ({ status: 'ok' }),
})

const server = Bun.serve({
  hostname: host,
  port: listenPort,
  fetch: handler.fetch,
})

console.log(`[webui] Front controller listening on http://${host}:${server.port ?? listenPort}`)
console.log(`[webui] Per-user backends use config dir base: ${baseConfigDir}`)

const shutdown = async () => {
  handler.dispose()
  server.stop()
  process.exit(0)
}

process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
