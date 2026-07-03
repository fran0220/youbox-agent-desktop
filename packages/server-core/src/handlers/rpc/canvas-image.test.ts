import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  CanvasDoc,
  CanvasGenerateImageResult,
  CanvasGenerateImageSuccess,
  PushTarget,
} from '@craft-agent/shared/protocol'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { createCanvasDoc, getCanvasAssetsDir, getCanvasDocPath, loadCanvasDoc } from '../../canvas/canvas-storage'
import { registerCanvasImageHandlers, HANDLED_CHANNELS } from './canvas-image'

const WORKSPACE_ID = 'ws-canvas-image-test'
const CONN_SLUG = 'test-image-conn'
// 1x1 transparent PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let configDir: string
let wsRoot: string
let prevConfigDir: string | undefined
let realFetch: typeof fetch

beforeAll(async () => {
  prevConfigDir = process.env.CRAFT_CONFIG_DIR
  configDir = mkdtempSync(join(tmpdir(), 'canvas-image-config-'))
  wsRoot = mkdtempSync(join(tmpdir(), 'canvas-image-ws-'))
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{ id: WORKSPACE_ID, name: 'Canvas Image Test', rootPath: wsRoot, createdAt: Date.now() }],
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: null,
    llmConnections: [{
      slug: CONN_SLUG,
      name: 'Test Image Conn',
      providerType: 'pi_compat',
      authType: 'api_key_with_endpoint',
      baseUrl: 'https://images.example.test/v1',
      models: [{ id: 'gpt-image-2', name: 'gpt-image-2', shortName: 'img' }],
      defaultModel: 'gpt-image-2',
      createdAt: Date.now(),
    }],
    defaultLlmConnection: CONN_SLUG,
  }))
  process.env.CRAFT_CONFIG_DIR = configDir
  await getCredentialManager().setLlmApiKey(CONN_SLUG, 'sk-test-secret-key')
  realFetch = globalThis.fetch
})

afterAll(() => {
  globalThis.fetch = realFetch
  if (prevConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = prevConfigDir
  rmSync(configDir, { recursive: true, force: true })
  rmSync(wsRoot, { recursive: true, force: true })
})

afterEach(() => {
  globalThis.fetch = realFetch
})

beforeEach(() => {
  rmSync(join(wsRoot, 'canvas'), { recursive: true, force: true })
})

interface PushRecord {
  channel: string
  target: PushTarget
  args: unknown[]
}

interface FetchCall {
  url: string
  init: RequestInit | undefined
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
  const deps = { platform: { logger: { info: noop, warn: noop, error: noop, debug: noop } } } as unknown as HandlerDeps
  registerCanvasImageHandlers(server, deps)
  const handler = handlers.get(RPC_CHANNELS.canvas.GENERATE_IMAGE)
  if (!handler) throw new Error('canvas:generateImage handler not registered')
  return { pushes, generate: handler }
}

function ctx(): RequestContext {
  return { clientId: 'client-1', workspaceId: WORKSPACE_ID, webContentsId: 1 }
}

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = []
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return Promise.resolve(impl(String(input), init))
  }) as unknown as typeof fetch
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('canvas:generateImage handler', () => {
  it('declares its handled channel', () => {
    expect([...HANDLED_CHANNELS]).toEqual([RPC_CHANNELS.canvas.GENERATE_IMAGE])
  })

  it('success: writes PNG asset, appends image node, bumps version, broadcasts changed', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Gen' })
    const calls = mockFetch(() => jsonResponse({ data: [{ b64_json: PNG_B64 }] }))
    const h = createHarness()

    const result = await h.generate(ctx(), {
      workspaceId: WORKSPACE_ID, docId: doc.id, prompt: 'a red cube',
    }) as CanvasGenerateImageResult

    expect(result.ok).toBe(true)
    const ok = result as CanvasGenerateImageSuccess
    expect(calls[0]?.url).toBe('https://images.example.test/v1/images/generations')
    expect(existsSync(ok.assetPath)).toBe(true)
    expect(ok.imageFileName.endsWith('.png')).toBe(true)
    expect(readFileSync(ok.assetPath).length).toBeGreaterThan(0)

    const stored = loadCanvasDoc(wsRoot, doc.id) as CanvasDoc
    expect(stored.version).toBe(doc.version + 1)
    const node = stored.nodes.find(n => n.id === ok.nodeId)
    expect(node?.type).toBe('image')
    expect((node as { data: { fileName: string; filePath: string } }).data.fileName).toBe(ok.imageFileName)

    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0]!.channel).toBe(RPC_CHANNELS.canvas.CHANGED)
    expect(h.pushes[0]!.target).toEqual({ to: 'workspace', workspaceId: WORKSPACE_ID })
    expect(h.pushes[0]!.args).toEqual([{ workspaceId: WORKSPACE_ID, docId: doc.id, kind: 'updated' }])
  })

  it('backfills an existing placeholder node into an image node', async () => {
    const doc = await createCanvasDoc(wsRoot, {
      name: 'Backfill',
      state: {
        nodes: [{ id: 'placeholder-1', type: 'text', position: { x: 12, y: 34 }, data: { text: 'loading' } }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    mockFetch(() => jsonResponse({ data: [{ b64_json: PNG_B64 }] }))
    const h = createHarness()

    const result = await h.generate(ctx(), {
      workspaceId: WORKSPACE_ID, docId: doc.id, prompt: 'fill me', nodeId: 'placeholder-1',
    }) as CanvasGenerateImageSuccess

    expect(result.ok).toBe(true)
    expect(result.nodeId).toBe('placeholder-1')
    const stored = loadCanvasDoc(wsRoot, doc.id) as CanvasDoc
    expect(stored.nodes).toHaveLength(1)
    const node = stored.nodes[0]!
    expect(node.type).toBe('image')
    expect(node.position).toEqual({ x: 12, y: 34 })
    expect((node as { data: { filePath: string } }).data.filePath).toBe(result.assetPath)
  })

  it('auth failure: typed error, no asset written, no doc mutation, no broadcast', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'AuthFail' })
    mockFetch(() => jsonResponse({ error: 'invalid api key' }, 401))
    const h = createHarness()

    const result = await h.generate(ctx(), {
      workspaceId: WORKSPACE_ID, docId: doc.id, prompt: 'nope',
    }) as CanvasGenerateImageResult

    expect(result).toEqual({ ok: false, code: 'auth', message: expect.any(String) })
    const assetsDir = getCanvasAssetsDir(wsRoot, doc.id)
    expect(existsSync(assetsDir) ? readdirSync(assetsDir) : []).toEqual([])
    const stored = loadCanvasDoc(wsRoot, doc.id) as CanvasDoc
    expect(stored.version).toBe(doc.version)
    expect(stored.nodes).toHaveLength(0)
    expect(h.pushes).toHaveLength(0)
  })

  it('network failure: typed error, no asset, no mutation', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'NetFail' })
    globalThis.fetch = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch
    const h = createHarness()

    const result = await h.generate(ctx(), {
      workspaceId: WORKSPACE_ID, docId: doc.id, prompt: 'nope',
    }) as CanvasGenerateImageResult

    expect(result.ok).toBe(false)
    expect((result as { code: string }).code).toBe('network')
    const stored = loadCanvasDoc(wsRoot, doc.id) as CanvasDoc
    expect(stored.version).toBe(doc.version)
    expect(h.pushes).toHaveLength(0)
  })

  it('no_connection: returns typed error when no image-capable connection resolves', async () => {
    // Isolated config with a connection that has no baseUrl (not image-capable)
    const otherConfig = mkdtempSync(join(tmpdir(), 'canvas-image-noconn-'))
    const otherWs = mkdtempSync(join(tmpdir(), 'canvas-image-noconn-ws-'))
    writeFileSync(join(otherConfig, 'config.json'), JSON.stringify({
      workspaces: [{ id: WORKSPACE_ID, name: 'x', rootPath: otherWs, createdAt: Date.now() }],
      activeWorkspaceId: WORKSPACE_ID,
      activeSessionId: null,
      llmConnections: [{ slug: 'no-base', name: 'No Base', providerType: 'anthropic', authType: 'oauth', createdAt: Date.now() }],
    }))
    const prev = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = otherConfig
    try {
      const doc = await createCanvasDoc(otherWs, { name: 'NoConn' })
      const h = createHarness()
      const result = await h.generate(ctx(), {
        workspaceId: WORKSPACE_ID, docId: doc.id, prompt: 'x',
      }) as CanvasGenerateImageResult
      expect(result).toEqual({ ok: false, code: 'no_connection', message: expect.any(String) })
    } finally {
      process.env.CRAFT_CONFIG_DIR = prev
      rmSync(otherConfig, { recursive: true, force: true })
      rmSync(otherWs, { recursive: true, force: true })
    }
  })

  it('persist_failed: rolls back the orphan asset and returns a typed error when the doc mutation fails', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'MutFail' })
    // Remove the doc file mid-flight (during the image fetch) so the asset write
    // still succeeds but the follow-up doc mutation throws "doc not found".
    const calls = mockFetch(() => {
      rmSync(getCanvasDocPath(wsRoot, doc.id), { force: true })
      return jsonResponse({ data: [{ b64_json: PNG_B64 }] })
    })
    const h = createHarness()

    const result = await h.generate(ctx(), {
      workspaceId: WORKSPACE_ID, docId: doc.id, prompt: 'boom',
    }) as CanvasGenerateImageResult

    expect(result).toEqual({ ok: false, code: 'persist_failed', message: expect.any(String) })
    expect(calls).toHaveLength(1)
    // The written PNG must not be orphaned on disk.
    const assetsDir = getCanvasAssetsDir(wsRoot, doc.id)
    expect(existsSync(assetsDir) ? readdirSync(assetsDir).filter(f => f.endsWith('.png')) : []).toEqual([])
    // No changed broadcast on failure.
    expect(h.pushes).toHaveLength(0)
  })

  it('reference confinement: an out-of-workspace referenceImagePath is skipped (no edits call)', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Confine' })
    const outsideDir = mkdtempSync(join(tmpdir(), 'canvas-image-outside-'))
    const outsideFile = join(outsideDir, 'secret.png')
    writeFileSync(outsideFile, Buffer.from(PNG_B64, 'base64'))
    try {
      const calls = mockFetch(() => jsonResponse({ data: [{ b64_json: PNG_B64 }] }))
      const h = createHarness()

      const result = await h.generate(ctx(), {
        workspaceId: WORKSPACE_ID, docId: doc.id, prompt: 'use ref', referenceImagePaths: [outsideFile],
      }) as CanvasGenerateImageResult

      expect(result.ok).toBe(true)
      // Confinement dropped the outside reference => no references => plain generation, never /images/edits.
      expect(calls.every(c => !c.url.endsWith('/images/edits'))).toBe(true)
      expect(calls.some(c => c.url.endsWith('/images/generations'))).toBe(true)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('image-to-image: outbound request hits /images/edits and includes the reference image', async () => {
    // Seed a doc with an existing image node whose asset exists on disk.
    const seed = await createCanvasDoc(wsRoot, { name: 'Seed' })
    const { writeCanvasAsset, addOrBackfillCanvasImageNode } = await import('../../canvas/canvas-storage')
    const refPath = await writeCanvasAsset(wsRoot, seed.id, 'ref.png', Buffer.from(PNG_B64, 'base64'))
    await addOrBackfillCanvasImageNode(wsRoot, seed.id, { nodeId: 'img-src', filePath: refPath, fileName: 'ref.png' })

    const calls = mockFetch((url) => {
      if (url.endsWith('/images/edits')) return jsonResponse({ data: [{ b64_json: PNG_B64 }] })
      return jsonResponse({ error: 'unexpected' }, 500)
    })
    const h = createHarness()

    const result = await h.generate(ctx(), {
      workspaceId: WORKSPACE_ID, docId: seed.id, prompt: 'restyle', referenceNodeIds: ['img-src'],
    }) as CanvasGenerateImageResult

    expect(result.ok).toBe(true)
    const editsCall = calls.find(c => c.url.endsWith('/images/edits'))
    expect(editsCall).toBeDefined()
    const body = editsCall!.init?.body
    expect(body).toBeInstanceOf(FormData)
    const images = (body as FormData).getAll('image')
    expect(images.length).toBe(1)
    expect((body as FormData).get('prompt')).toBe('restyle')
  })
})
