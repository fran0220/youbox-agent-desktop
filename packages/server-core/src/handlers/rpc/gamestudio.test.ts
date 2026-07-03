import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { PushTarget } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { getGameProjectDir } from '../../gamestudio/game-project-storage'
import { HANDLED_CHANNELS, registerGameStudioHandlers } from './gamestudio'

const WORKSPACE_ID = 'ws-gamestudio-test'

let configDir: string
let wsRoot: string
let appRoot: string
let prevConfigDir: string | undefined

beforeAll(() => {
  prevConfigDir = process.env.CRAFT_CONFIG_DIR
  configDir = mkdtempSync(join(tmpdir(), 'gamestudio-rpc-config-'))
  wsRoot = mkdtempSync(join(tmpdir(), 'gamestudio-rpc-ws-'))
  appRoot = mkdtempSync(join(tmpdir(), 'gamestudio-rpc-app-'))
  const vendorDir = join(appRoot, 'apps', 'electron', 'resources', 'gamestudio', 'vendor')
  mkdirSync(vendorDir, { recursive: true })
  writeFileSync(join(vendorDir, 'three.module.js'), 'export const REVISION = "test-three";')
  writeFileSync(join(vendorDir, 'rapier.es.js'), 'export default async function init() {}')
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{ id: WORKSPACE_ID, name: 'Game Studio Test', rootPath: wsRoot, createdAt: Date.now() }],
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: null,
    llmConnections: [],
  }))
  process.env.CRAFT_CONFIG_DIR = configDir
})

afterAll(() => {
  if (prevConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = prevConfigDir
  rmSync(configDir, { recursive: true, force: true })
  rmSync(wsRoot, { recursive: true, force: true })
  rmSync(appRoot, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(join(wsRoot, 'gamestudio'), { recursive: true, force: true })
})

interface PushRecord {
  channel: string
  target: PushTarget
  args: unknown[]
}

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const pushes: PushRecord[] = []
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push(channel, target, ...args) { pushes.push({ channel, target, args }) },
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const noop = () => {}
  const deps = {
    platform: {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: false,
      logger: { info: noop, warn: noop, error: noop, debug: noop },
    },
  } as unknown as HandlerDeps
  registerGameStudioHandlers(server, deps)
  return { handlers, pushes }
}

function ctx(): RequestContext {
  return { clientId: 'client-1', workspaceId: WORKSPACE_ID, webContentsId: 1 }
}

describe('gamestudio RPC handlers', () => {
  it('declares handled channels', () => {
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.gamestudio.LIST,
      RPC_CHANNELS.gamestudio.GET,
      RPC_CHANNELS.gamestudio.CREATE,
      RPC_CHANNELS.gamestudio.UPDATE,
      RPC_CHANNELS.gamestudio.DELETE,
    ])
  })

  it('create, update and delete broadcast gamestudio:changed and mutate project directories', async () => {
    const h = createHarness()
    const create = h.handlers.get(RPC_CHANNELS.gamestudio.CREATE)!
    const update = h.handlers.get(RPC_CHANNELS.gamestudio.UPDATE)!
    const list = h.handlers.get(RPC_CHANNELS.gamestudio.LIST)!
    const del = h.handlers.get(RPC_CHANNELS.gamestudio.DELETE)!

    const project = await create(ctx(), WORKSPACE_ID, { name: 'RPC Game' })
    expect(project.name).toBe('RPC Game')
    expect(existsSync(join(getGameProjectDir(wsRoot, project.id), 'index.html'))).toBe(true)
    expect(h.pushes[0]).toEqual({
      channel: RPC_CHANNELS.gamestudio.CHANGED,
      target: { to: 'workspace', workspaceId: WORKSPACE_ID },
      args: [{ workspaceId: WORKSPACE_ID, projectId: project.id, kind: 'created' }],
    })

    const updated = await update(ctx(), WORKSPACE_ID, project.id, { name: 'Renamed' })
    expect(updated.name).toBe('Renamed')
    expect(updated.version).toBe(2)
    expect(h.pushes[1]!.args).toEqual([{ workspaceId: WORKSPACE_ID, projectId: project.id, kind: 'updated' }])

    const metas = await list(ctx(), WORKSPACE_ID)
    expect(metas.map((meta: { id: string }) => meta.id)).toEqual([project.id])

    await del(ctx(), WORKSPACE_ID, project.id)
    expect(existsSync(getGameProjectDir(wsRoot, project.id))).toBe(false)
    expect(h.pushes[2]!.args).toEqual([{ workspaceId: WORKSPACE_ID, projectId: project.id, kind: 'deleted' }])
  })
})
