import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { CanvasChangedEvent, CanvasDoc, CanvasDocMeta, CanvasDocState, PushTarget } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { getCanvasDocPath, setCanvasDocChatSessionId } from '../../canvas/canvas-storage'
import { HANDLED_CHANNELS, registerCanvasHandlers } from './canvas'

const WORKSPACE_ID = 'ws-canvas-handler-test'

let configDir: string
let wsRoot: string
let prevConfigDir: string | undefined

beforeAll(() => {
  prevConfigDir = process.env.CRAFT_CONFIG_DIR
  configDir = mkdtempSync(join(tmpdir(), 'canvas-handler-config-'))
  wsRoot = mkdtempSync(join(tmpdir(), 'canvas-handler-ws-'))
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{ id: WORKSPACE_ID, name: 'Canvas Handler Test', rootPath: wsRoot, createdAt: Date.now() }],
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: null,
  }))
  process.env.CRAFT_CONFIG_DIR = configDir
})

afterAll(() => {
  if (prevConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = prevConfigDir
  rmSync(configDir, { recursive: true, force: true })
  rmSync(wsRoot, { recursive: true, force: true })
})

interface PushRecord {
  channel: string
  target: PushTarget
  args: unknown[]
}

function createHarness(opts: { deleteSession?: (sessionId: string) => Promise<void> } = {}) {
  const handlers = new Map<string, HandlerFn>()
  const pushes: PushRecord[] = []

  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push(channel, target, ...args) {
      pushes.push({ channel, target, args })
    },
    async invokeClient() {
      return undefined
    },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }

  const noop = () => {}
  const deletedSessions: string[] = []
  const deps = {
    platform: { logger: { info: noop, warn: noop, error: noop, debug: noop } },
    sessionManager: {
      async deleteSession(sessionId: string) {
        deletedSessions.push(sessionId)
        if (opts.deleteSession) await opts.deleteSession(sessionId)
      },
    },
  } as unknown as HandlerDeps

  registerCanvasHandlers(server, deps)

  const get = (channel: string): HandlerFn => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`canvas handler not registered: ${channel}`)
    return handler
  }

  return {
    pushes,
    deletedSessions,
    list: get(RPC_CHANNELS.canvas.LIST),
    get: get(RPC_CHANNELS.canvas.GET),
    create: get(RPC_CHANNELS.canvas.CREATE),
    update: get(RPC_CHANNELS.canvas.UPDATE),
    delete: get(RPC_CHANNELS.canvas.DELETE),
  }
}

function ctx(): RequestContext {
  return { clientId: 'client-1', workspaceId: WORKSPACE_ID, webContentsId: 1 }
}

function state(text: string): CanvasDocState {
  return {
    nodes: [{ id: 'text-1', type: 'text', position: { x: 0, y: 0 }, data: { text } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

function expectChanged(push: PushRecord, docId: string, kind: CanvasChangedEvent['kind']) {
  expect(push.channel).toBe(RPC_CHANNELS.canvas.CHANGED)
  expect(push.target).toEqual({ to: 'workspace', workspaceId: WORKSPACE_ID })
  expect(push.args).toEqual([{ workspaceId: WORKSPACE_ID, docId, kind }])
}

describe('canvas rpc handlers', () => {
  beforeEach(() => {
    rmSync(join(wsRoot, 'canvas'), { recursive: true, force: true })
  })

  it('declares its handled channels', () => {
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.canvas.LIST,
      RPC_CHANNELS.canvas.GET,
      RPC_CHANNELS.canvas.CREATE,
      RPC_CHANNELS.canvas.UPDATE,
      RPC_CHANNELS.canvas.DELETE,
    ])
  })

  it('create persists the doc and broadcasts canvas:changed created to the workspace', async () => {
    const h = createHarness()
    const doc = await h.create(ctx(), WORKSPACE_ID, { name: 'My Canvas', state: state('hi') }) as CanvasDoc

    expect(doc.name).toBe('My Canvas')
    expect(existsSync(getCanvasDocPath(wsRoot, doc.id))).toBe(true)
    expect(h.pushes).toHaveLength(1)
    expectChanged(h.pushes[0], doc.id, 'created')
  })

  it('get returns the stored doc, and null for a missing one', async () => {
    const h = createHarness()
    const doc = await h.create(ctx(), WORKSPACE_ID, { name: 'Fetch me' }) as CanvasDoc

    const fetched = await h.get(ctx(), WORKSPACE_ID, doc.id) as CanvasDoc
    expect(fetched).toEqual(doc)
    expect(await h.get(ctx(), WORKSPACE_ID, 'missing-doc')).toBeNull()
  })

  it('list returns doc metas for the workspace', async () => {
    const h = createHarness()
    const doc = await h.create(ctx(), WORKSPACE_ID, { name: 'Listed' }) as CanvasDoc

    const metas = await h.list(ctx(), WORKSPACE_ID) as CanvasDocMeta[]
    expect(metas).toEqual([
      { id: doc.id, name: 'Listed', createdAt: doc.createdAt, updatedAt: doc.updatedAt, version: doc.version },
    ])
  })

  it('update persists changes, bumps version and broadcasts canvas:changed updated', async () => {
    const h = createHarness()
    const doc = await h.create(ctx(), WORKSPACE_ID, { name: 'Old' }) as CanvasDoc

    const updated = await h.update(ctx(), WORKSPACE_ID, doc.id, { name: 'New', state: state('bye') }) as CanvasDoc
    expect(updated.name).toBe('New')
    expect(updated.version).toBe(doc.version + 1)

    expect(h.pushes).toHaveLength(2)
    expectChanged(h.pushes[1], doc.id, 'updated')
  })

  it('update with chatSessionId persists it via the metadata helper without bumping version or broadcasting', async () => {
    const h = createHarness()
    const doc = await h.create(ctx(), WORKSPACE_ID, { name: 'BindSession' }) as CanvasDoc
    expect(h.pushes).toHaveLength(1) // only the create broadcast

    const bound = await h.update(ctx(), WORKSPACE_ID, doc.id, { chatSessionId: 'hidden-sess-9' }) as CanvasDoc
    expect(bound.chatSessionId).toBe('hidden-sess-9')
    // Metadata-only bind: content version is untouched and nothing is broadcast.
    expect(bound.version).toBe(doc.version)
    expect(h.pushes).toHaveLength(1)

    // Persisted to disk and readable via get.
    const fetched = await h.get(ctx(), WORKSPACE_ID, doc.id) as CanvasDoc
    expect(fetched.chatSessionId).toBe('hidden-sess-9')
    expect(fetched.version).toBe(doc.version)
  })

  it('update with both content and chatSessionId bumps version for content and returns the bound doc', async () => {
    const h = createHarness()
    const doc = await h.create(ctx(), WORKSPACE_ID, { name: 'Both' }) as CanvasDoc

    const updated = await h.update(ctx(), WORKSPACE_ID, doc.id, { name: 'Both2', chatSessionId: 'sess-both' }) as CanvasDoc
    expect(updated.name).toBe('Both2')
    expect(updated.chatSessionId).toBe('sess-both')
    expect(updated.version).toBe(doc.version + 1)
    // Content change still broadcasts (create + update).
    expect(h.pushes).toHaveLength(2)
    expectChanged(h.pushes[1], doc.id, 'updated')
  })

  it('delete removes the doc and broadcasts canvas:changed deleted exactly once', async () => {
    const h = createHarness()
    const doc = await h.create(ctx(), WORKSPACE_ID, { name: 'Doomed' }) as CanvasDoc

    await h.delete(ctx(), WORKSPACE_ID, doc.id)
    expect(existsSync(getCanvasDocPath(wsRoot, doc.id))).toBe(false)
    expect(h.pushes).toHaveLength(2)
    expectChanged(h.pushes[1], doc.id, 'deleted')

    // Idempotent: deleting again neither throws nor re-broadcasts
    await h.delete(ctx(), WORKSPACE_ID, doc.id)
    expect(h.pushes).toHaveLength(2)
  })

  it('delete cleans up the bound hidden chat session', async () => {
    const h = createHarness()
    const doc = await h.create(ctx(), WORKSPACE_ID, { name: 'HasSession' }) as CanvasDoc
    await setCanvasDocChatSessionId(wsRoot, doc.id, 'hidden-sess-1')

    await h.delete(ctx(), WORKSPACE_ID, doc.id)

    expect(h.deletedSessions).toEqual(['hidden-sess-1'])
    expect(existsSync(getCanvasDocPath(wsRoot, doc.id))).toBe(false)
    expectChanged(h.pushes[h.pushes.length - 1], doc.id, 'deleted')
  })

  it('delete without a bound session does not touch the session manager', async () => {
    const h = createHarness()
    const doc = await h.create(ctx(), WORKSPACE_ID, { name: 'NoSession' }) as CanvasDoc

    await h.delete(ctx(), WORKSPACE_ID, doc.id)
    expect(h.deletedSessions).toEqual([])
  })

  it('a failing session cleanup does not fail the doc delete', async () => {
    const h = createHarness({ deleteSession: async () => { throw new Error('session gone') } })
    const doc = await h.create(ctx(), WORKSPACE_ID, { name: 'FlakySession' }) as CanvasDoc
    await setCanvasDocChatSessionId(wsRoot, doc.id, 'hidden-sess-2')

    await h.delete(ctx(), WORKSPACE_ID, doc.id)
    expect(existsSync(getCanvasDocPath(wsRoot, doc.id))).toBe(false)
    expectChanged(h.pushes[h.pushes.length - 1], doc.id, 'deleted')
  })

  it('update conflicts resolve last-write-wins through the serialized queue', async () => {
    const h = createHarness()
    const doc = await h.create(ctx(), WORKSPACE_ID, { name: 'Contended' }) as CanvasDoc

    const [first, second] = await Promise.all([
      h.update(ctx(), WORKSPACE_ID, doc.id, { state: state('first') }) as Promise<CanvasDoc>,
      h.update(ctx(), WORKSPACE_ID, doc.id, { state: state('second') }) as Promise<CanvasDoc>,
    ])
    expect([first.version, second.version].sort()).toEqual([2, 3])

    const final = await h.get(ctx(), WORKSPACE_ID, doc.id) as CanvasDoc
    expect(final.version).toBe(3)
    expect((final.nodes[0] as { data: { text: string } }).data.text).toBe('second')
  })

  it('rejects unknown workspaces', async () => {
    const h = createHarness()
    expect(await h.list(ctx(), 'no-such-workspace')).toEqual([])
    await expect(h.create(ctx(), 'no-such-workspace', {})).rejects.toThrow('Workspace not found')
    await expect(h.update(ctx(), 'no-such-workspace', 'x', {})).rejects.toThrow('Workspace not found')
    await expect(h.delete(ctx(), 'no-such-workspace', 'x')).rejects.toThrow('Workspace not found')
    expect(h.pushes).toHaveLength(0)
  })
})
