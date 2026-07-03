import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { PushTarget } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { getDesignProjectDir } from '../../design/design-project-storage'
import { HANDLED_CHANNELS, registerDesignHandlers } from './design'

const WORKSPACE_ID = 'ws-design-test'

let configDir: string
let wsRoot: string
let appRoot: string
let prevConfigDir: string | undefined

beforeAll(() => {
  prevConfigDir = process.env.CRAFT_CONFIG_DIR
  configDir = mkdtempSync(join(tmpdir(), 'design-rpc-config-'))
  wsRoot = mkdtempSync(join(tmpdir(), 'design-rpc-ws-'))
  appRoot = mkdtempSync(join(tmpdir(), 'design-rpc-app-'))
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{ id: WORKSPACE_ID, name: 'Design Test', rootPath: wsRoot, createdAt: Date.now() }],
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
  rmSync(join(wsRoot, 'design'), { recursive: true, force: true })
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
  registerDesignHandlers(server, deps)
  return { handlers, pushes }
}

function ctx(): RequestContext {
  return { clientId: 'client-1', workspaceId: WORKSPACE_ID, webContentsId: 1 }
}

describe('design RPC handlers', () => {
  it('declares handled channels', () => {
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.design.LIST,
      RPC_CHANNELS.design.GET,
      RPC_CHANNELS.design.CREATE,
      RPC_CHANNELS.design.UPDATE,
      RPC_CHANNELS.design.DELETE,
    ])
  })

  it('create, update and delete broadcast design:changed and mutate project directories', async () => {
    const h = createHarness()
    const create = h.handlers.get(RPC_CHANNELS.design.CREATE)!
    const update = h.handlers.get(RPC_CHANNELS.design.UPDATE)!
    const list = h.handlers.get(RPC_CHANNELS.design.LIST)!
    const get = h.handlers.get(RPC_CHANNELS.design.GET)!
    const del = h.handlers.get(RPC_CHANNELS.design.DELETE)!

    const project = await create(ctx(), WORKSPACE_ID, { name: 'RPC Design', kind: 'deck' })
    expect(project.name).toBe('RPC Design')
    expect(project.kind).toBe('deck')
    expect(existsSync(join(getDesignProjectDir(wsRoot, project.id), 'index.html'))).toBe(true)
    expect(h.pushes[0]).toEqual({
      channel: RPC_CHANNELS.design.CHANGED,
      target: { to: 'workspace', workspaceId: WORKSPACE_ID },
      args: [{ workspaceId: WORKSPACE_ID, projectId: project.id, kind: 'created' }],
    })

    expect(await get(ctx(), WORKSPACE_ID, 'missing-id')).toBeNull()

    const updated = await update(ctx(), WORKSPACE_ID, project.id, { name: 'Renamed' })
    expect(updated.name).toBe('Renamed')
    expect(updated.version).toBe(2)
    expect(h.pushes[1]!.args).toEqual([{ workspaceId: WORKSPACE_ID, projectId: project.id, kind: 'updated' }])

    const metas = await list(ctx(), WORKSPACE_ID)
    expect(metas.map((meta: { id: string }) => meta.id)).toEqual([project.id])

    await del(ctx(), WORKSPACE_ID, project.id)
    expect(existsSync(getDesignProjectDir(wsRoot, project.id))).toBe(false)
    expect(h.pushes[2]!.args).toEqual([{ workspaceId: WORKSPACE_ID, projectId: project.id, kind: 'deleted' }])
  })

  it('does not broadcast for read-only operations', async () => {
    const h = createHarness()
    await h.handlers.get(RPC_CHANNELS.design.LIST)!(ctx(), WORKSPACE_ID)
    await h.handlers.get(RPC_CHANNELS.design.GET)!(ctx(), WORKSPACE_ID, 'missing-id')
    expect(h.pushes).toEqual([])
  })
})
