import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CanvasChangedKind } from '@craft-agent/shared/protocol'
import {
  CANVAS_MAX_NODES,
  createCanvasDoc,
  loadCanvasDoc,
  setCanvasDocChatSessionId,
  ensureCanvasAssetsDir,
} from './canvas-storage'
import { createCanvasToolFns, resolveDocIdForSession } from './canvas-tool-service'
import type { ResolvedImageConnection } from './image-generation'

const WORKSPACE_ID = 'ws-tool-service'
const SESSION_ID = 'sess-canvas-1'
// base64 of "hello" — valid base64 bytes for asset write
const IMG_B64 = 'aGVsbG8='

let wsRoot: string
let outsideRoot: string

beforeEach(() => {
  wsRoot = mkdtempSync(join(tmpdir(), 'canvas-tool-service-'))
  outsideRoot = mkdtempSync(join(tmpdir(), 'canvas-tool-outside-'))
})

afterEach(() => {
  rmSync(wsRoot, { recursive: true, force: true })
  rmSync(outsideRoot, { recursive: true, force: true })
})

interface Broadcast {
  docId: string
  kind: CanvasChangedKind
}

function makeFns(opts: { withImageGen?: boolean } = {}) {
  const broadcasts: Broadcast[] = []
  const connection: ResolvedImageConnection = {
    slug: 'test',
    baseUrl: 'https://images.example.test/v1',
    apiKey: 'sk-secret',
    model: 'gpt-image-2',
  }
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ data: [{ b64_json: IMG_B64 }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch

  const fns = createCanvasToolFns({
    sessionId: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    workspaceRootPath: wsRoot,
    broadcastChanged: (docId, kind) => broadcasts.push({ docId, kind }),
    imageGenerationDeps: opts.withImageGen
      ? { connectionResolver: async () => connection, fetchImpl }
      : undefined,
  })
  return { fns, broadcasts }
}

async function boundDoc(name = 'Bound') {
  const doc = await createCanvasDoc(wsRoot, { name })
  await setCanvasDocChatSessionId(wsRoot, doc.id, SESSION_ID)
  return doc
}

describe('resolveDocIdForSession', () => {
  it('returns the doc bound to the session, null otherwise', async () => {
    const doc = await boundDoc()
    expect(resolveDocIdForSession(wsRoot, SESSION_ID)).toBe(doc.id)
    expect(resolveDocIdForSession(wsRoot, 'other-session')).toBeNull()
  })
})

describe('createCanvasToolFns — happy paths + broadcast', () => {
  it('listNodes returns the bound doc summary', async () => {
    const doc = await createCanvasDoc(wsRoot, {
      name: 'L',
      state: {
        nodes: [{ id: 'n1', type: 'text', position: { x: 1, y: 2 }, data: { text: 'hi' } }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    await setCanvasDocChatSessionId(wsRoot, doc.id, SESSION_ID)
    const { fns } = makeFns()
    const result = await fns.listNodes()
    expect(result.docId).toBe(doc.id)
    expect(result.nodes).toEqual([{ id: 'n1', type: 'text', position: { x: 1, y: 2 }, text: 'hi' }])
  })

  it('createNode (text) persists and broadcasts updated', async () => {
    const doc = await boundDoc()
    const { fns, broadcasts } = makeFns()
    const { nodeId, type } = await fns.createNode({ type: 'text', text: 'note', x: 3, y: 4 })
    expect(type).toBe('text')
    const stored = loadCanvasDoc(wsRoot, doc.id)!
    expect(stored.nodes.find(n => n.id === nodeId)).toBeDefined()
    expect(broadcasts).toEqual([{ docId: doc.id, kind: 'updated' }])
  })

  it('createNode (image) confines the path and persists an image node', async () => {
    const doc = await boundDoc()
    const assetsDir = ensureCanvasAssetsDir(wsRoot, doc.id)
    const imgPath = join(assetsDir, 'inside.png')
    writeFileSync(imgPath, Buffer.from(IMG_B64, 'base64'))
    const { fns, broadcasts } = makeFns()
    const { nodeId, type } = await fns.createNode({ type: 'image', imagePath: imgPath })
    expect(type).toBe('image')
    const node = loadCanvasDoc(wsRoot, doc.id)!.nodes.find(n => n.id === nodeId)
    expect(node?.type).toBe('image')
    expect((node as { data: { filePath: string } }).data.filePath).toBe(imgPath)
    expect(broadcasts).toHaveLength(1)
  })

  it('updateNode persists and broadcasts', async () => {
    const doc = await createCanvasDoc(wsRoot, {
      name: 'U',
      state: {
        nodes: [{ id: 't1', type: 'text', position: { x: 0, y: 0 }, data: { text: 'a' } }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    await setCanvasDocChatSessionId(wsRoot, doc.id, SESSION_ID)
    const { fns, broadcasts } = makeFns()
    await fns.updateNode({ nodeId: 't1', x: 42, text: 'b' })
    const node = loadCanvasDoc(wsRoot, doc.id)!.nodes[0]! as { position: { x: number }; data: { text: string } }
    expect(node.position.x).toBe(42)
    expect(node.data.text).toBe('b')
    expect(broadcasts).toEqual([{ docId: doc.id, kind: 'updated' }])
  })

  it('connect adds an edge and broadcasts', async () => {
    const doc = await createCanvasDoc(wsRoot, {
      name: 'C',
      state: {
        nodes: [
          { id: 'a', type: 'text', position: { x: 0, y: 0 }, data: { text: 'a' } },
          { id: 'b', type: 'text', position: { x: 1, y: 1 }, data: { text: 'b' } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    await setCanvasDocChatSessionId(wsRoot, doc.id, SESSION_ID)
    const { fns, broadcasts } = makeFns()
    const { edgeId } = await fns.connect({ source: 'a', target: 'b' })
    expect(loadCanvasDoc(wsRoot, doc.id)!.edges[0]).toEqual({ id: edgeId, source: 'a', target: 'b' })
    expect(broadcasts).toEqual([{ docId: doc.id, kind: 'updated' }])
  })

  it('generateImage (mocked connection + fetch) persists an image node and broadcasts', async () => {
    const doc = await boundDoc()
    const { fns, broadcasts } = makeFns({ withImageGen: true })
    const { nodeId, imageFileName } = await fns.generateImage({ prompt: 'a red cube' })
    expect(imageFileName.endsWith('.png')).toBe(true)
    const node = loadCanvasDoc(wsRoot, doc.id)!.nodes.find(n => n.id === nodeId)
    expect(node?.type).toBe('image')
    expect(broadcasts).toEqual([{ docId: doc.id, kind: 'updated' }])
  })
})

describe('createCanvasToolFns — errors', () => {
  it('unbound session: every tool reports "not bound" and does not broadcast', async () => {
    // No doc bound to SESSION_ID.
    await createCanvasDoc(wsRoot, { name: 'Unrelated' })
    const { fns, broadcasts } = makeFns()
    await expect(fns.listNodes()).rejects.toThrow('not bound to a canvas document')
    await expect(fns.createNode({ type: 'text', text: 'x' })).rejects.toThrow('not bound')
    await expect(fns.connect({ source: 'a', target: 'b' })).rejects.toThrow('not bound')
    expect(broadcasts).toHaveLength(0)
  })

  it('updateNode on an unknown node throws and does not broadcast', async () => {
    await boundDoc()
    const { fns, broadcasts } = makeFns()
    await expect(fns.updateNode({ nodeId: 'ghost', x: 1 })).rejects.toThrow('not found')
    expect(broadcasts).toHaveLength(0)
  })

  it('createNode (image) rejects an out-of-workspace path and does not broadcast', async () => {
    await boundDoc()
    const outsideFile = join(outsideRoot, 'secret.png')
    writeFileSync(outsideFile, Buffer.from(IMG_B64, 'base64'))
    const { fns, broadcasts } = makeFns()
    await expect(fns.createNode({ type: 'image', imagePath: outsideFile })).rejects.toThrow('outside the workspace')
    expect(broadcasts).toHaveLength(0)
  })

  it('createNode at the node cap reports the limit error and does not broadcast', async () => {
    const doc = await createCanvasDoc(wsRoot, {
      name: 'Capped',
      state: {
        nodes: Array.from({ length: CANVAS_MAX_NODES }, (_, i) => ({
          id: `n${i}`,
          type: 'text' as const,
          position: { x: i, y: i },
          data: { text: String(i) },
        })),
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    await setCanvasDocChatSessionId(wsRoot, doc.id, SESSION_ID)
    const { fns, broadcasts } = makeFns()

    await expect(fns.createNode({ type: 'text', text: 'overflow' })).rejects.toThrow('canvas node limit reached')

    const stored = loadCanvasDoc(wsRoot, doc.id)!
    expect(stored.nodes).toHaveLength(CANVAS_MAX_NODES)
    expect(broadcasts).toHaveLength(0)
  })

  it('connect to a missing node throws and does not broadcast', async () => {
    const doc = await createCanvasDoc(wsRoot, {
      name: 'C',
      state: {
        nodes: [{ id: 'a', type: 'text', position: { x: 0, y: 0 }, data: { text: 'a' } }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    await setCanvasDocChatSessionId(wsRoot, doc.id, SESSION_ID)
    const { fns, broadcasts } = makeFns()
    await expect(fns.connect({ source: 'a', target: 'ghost' })).rejects.toThrow('not found')
    expect(broadcasts).toHaveLength(0)
  })
})
