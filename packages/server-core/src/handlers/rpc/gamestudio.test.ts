import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { PushTarget } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { getGameProjectDir } from '../../gamestudio/game-project-storage'
import {
  HANDLED_CHANNELS,
  getGameStudioResourcesRootCandidates,
  registerGameStudioHandlers,
  resolveGameStudioResourcesRoot,
} from './gamestudio'

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

function writeVendorFixture(resourcesRoot: string) {
  const vendorDir = join(resourcesRoot, 'gamestudio', 'vendor')
  mkdirSync(vendorDir, { recursive: true })
  writeFileSync(join(vendorDir, 'three.module.js'), 'export const REVISION = "test-three";')
  writeFileSync(join(vendorDir, 'rapier.es.js'), 'export default async function init() {}')
}

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

describe('resolveGameStudioResourcesRoot', () => {
  it('exposes the packaged candidate matrix for electron-builder app and asar-style layouts', () => {
    const platform = {
      appRootPath: '/Applications/OriginAI.app/Contents/Resources/app.asar',
      resourcesPath: '/Applications/OriginAI.app/Contents/Resources',
      isPackaged: true,
    }

    const candidates = getGameStudioResourcesRootCandidates(platform)

    expect(candidates).toEqual([
      '/Applications/OriginAI.app/Contents/Resources/app.asar/dist/resources',
      '/Applications/OriginAI.app/Contents/Resources/app.asar/resources',
      '/Applications/OriginAI.app/Contents/Resources/app/dist/resources',
      '/Applications/OriginAI.app/Contents/Resources/app/resources',
    ])
  })

  it('deduplicates overlapping packaged candidates for pure path existence tests', () => {
    const appRootPath = '/Applications/OriginAI.app/Contents/Resources/app'

    expect(getGameStudioResourcesRootCandidates({
      appRootPath,
      resourcesPath: '/Applications/OriginAI.app/Contents/Resources',
      isPackaged: true,
    })).toEqual([
      join(appRootPath, 'dist', 'resources'),
      join(appRootPath, 'resources'),
    ])
  })

  it('exposes the dev candidate matrix for source resources and built dist resources', () => {
    const platform = {
      appRootPath: '/repo',
      resourcesPath: '/repo/apps/electron',
      isPackaged: false,
    }

    const candidates = getGameStudioResourcesRootCandidates(platform)

    expect(candidates).toContain('/repo/apps/electron/resources')
    expect(candidates).toContain('/repo/apps/electron/dist/resources')
    expect(candidates).toContain('/repo/resources')
  })

  it('prefers the dev source resources path when the app is not packaged', () => {
    const devAppRoot = mkdtempSync(join(tmpdir(), 'gamestudio-rpc-dev-app-'))
    try {
      const resourcesRoot = join(devAppRoot, 'apps', 'electron', 'resources')
      writeVendorFixture(resourcesRoot)

      const resolved = resolveGameStudioResourcesRoot({
        appRootPath: devAppRoot,
        resourcesPath: devAppRoot,
        isPackaged: false,
      } as HandlerDeps['platform'])

      expect(resolved).toBe(resourcesRoot)
    } finally {
      rmSync(devAppRoot, { recursive: true, force: true })
    }
  })

  it('resolves dev built dist resources when source resources are unavailable', () => {
    const devAppRoot = mkdtempSync(join(tmpdir(), 'gamestudio-rpc-dev-dist-app-'))
    try {
      const resourcesRoot = join(devAppRoot, 'apps', 'electron', 'dist', 'resources')
      writeVendorFixture(resourcesRoot)

      const resolved = resolveGameStudioResourcesRoot({
        appRootPath: devAppRoot,
        resourcesPath: devAppRoot,
        isPackaged: false,
      } as HandlerDeps['platform'])

      expect(resolved).toBe(resourcesRoot)
    } finally {
      rmSync(devAppRoot, { recursive: true, force: true })
    }
  })

  it('resolves packaged resources from the app dist/resources directory included by electron-builder files', () => {
    const packagedResourcesRoot = mkdtempSync(join(tmpdir(), 'gamestudio-rpc-packaged-dist-'))
    try {
      const appRootPath = join(packagedResourcesRoot, 'app')
      const resourcesRoot = join(appRootPath, 'dist', 'resources')
      writeVendorFixture(resourcesRoot)

      const resolved = resolveGameStudioResourcesRoot({
        appRootPath,
        resourcesPath: packagedResourcesRoot,
        isPackaged: true,
      } as HandlerDeps['platform'])

      expect(resolved).toBe(resourcesRoot)
    } finally {
      rmSync(packagedResourcesRoot, { recursive: true, force: true })
    }
  })

  it('resolves packaged resources from app/resources when a platform-specific extraResources mapping places assets there', () => {
    const packagedResourcesRoot = mkdtempSync(join(tmpdir(), 'gamestudio-rpc-packaged-extra-'))
    try {
      const appRootPath = join(packagedResourcesRoot, 'app')
      const resourcesRoot = join(appRootPath, 'resources')
      writeVendorFixture(resourcesRoot)

      const resolved = resolveGameStudioResourcesRoot({
        appRootPath,
        resourcesPath: packagedResourcesRoot,
        isPackaged: true,
      } as HandlerDeps['platform'])

      expect(resolved).toBe(resourcesRoot)
    } finally {
      rmSync(packagedResourcesRoot, { recursive: true, force: true })
    }
  })
})
