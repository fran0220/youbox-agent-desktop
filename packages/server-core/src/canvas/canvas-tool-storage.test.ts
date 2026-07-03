import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  addCanvasEdge,
  addCanvasNode,
  createCanvasDoc,
  loadCanvasDoc,
  updateCanvasNode,
} from './canvas-storage'

let wsRoot: string

beforeEach(() => {
  wsRoot = mkdtempSync(join(tmpdir(), 'canvas-tool-storage-'))
})

afterEach(() => {
  rmSync(wsRoot, { recursive: true, force: true })
})

describe('addCanvasNode', () => {
  it('appends a text node with a fresh id and bumps version', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'N' })
    const { doc: next, nodeId } = await addCanvasNode(wsRoot, doc.id, {
      type: 'text',
      position: { x: 5, y: 6 },
      data: { text: 'hi' },
    })
    expect(next.version).toBe(doc.version + 1)
    expect(next.nodes).toHaveLength(1)
    const node = next.nodes[0]!
    expect(node.id).toBe(nodeId)
    expect(node.type).toBe('text')
    expect((node as { data: { text: string } }).data.text).toBe('hi')
    expect(loadCanvasDoc(wsRoot, doc.id)!.nodes[0]!.id).toBe(nodeId)
  })

  it('honors an explicit id and appends an image node', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'N' })
    const { nodeId } = await addCanvasNode(wsRoot, doc.id, {
      id: 'img-1',
      type: 'image',
      position: { x: 0, y: 0 },
      data: { filePath: join(wsRoot, 'a.png'), fileName: 'a.png' },
    })
    expect(nodeId).toBe('img-1')
  })

  it('rejects a duplicate explicit id', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'N' })
    await addCanvasNode(wsRoot, doc.id, { id: 'dup', type: 'text', position: { x: 0, y: 0 }, data: { text: 'a' } })
    await expect(
      addCanvasNode(wsRoot, doc.id, { id: 'dup', type: 'text', position: { x: 1, y: 1 }, data: { text: 'b' } }),
    ).rejects.toThrow('already exists')
  })

  it('throws for a missing doc', async () => {
    await expect(
      addCanvasNode(wsRoot, 'nope', { type: 'text', position: { x: 0, y: 0 }, data: { text: 'a' } }),
    ).rejects.toThrow('not found')
  })
})

describe('updateCanvasNode', () => {
  it('updates position/size and text, bumping version', async () => {
    const doc = await createCanvasDoc(wsRoot, {
      name: 'U',
      state: {
        nodes: [{ id: 't1', type: 'text', position: { x: 0, y: 0 }, data: { text: 'old' } }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    const { doc: next } = await updateCanvasNode(wsRoot, doc.id, 't1', { position: { x: 9, y: 8 }, width: 100, text: 'new' })
    expect(next.version).toBe(doc.version + 1)
    const node = next.nodes[0]! as { position: { x: number; y: number }; width?: number; data: { text: string } }
    expect(node.position).toEqual({ x: 9, y: 8 })
    expect(node.width).toBe(100)
    expect(node.data.text).toBe('new')
  })

  it('throws for an unknown node', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'U' })
    await expect(updateCanvasNode(wsRoot, doc.id, 'ghost', { width: 1 })).rejects.toThrow('not found')
  })

  it('refuses to set text on an image node', async () => {
    const doc = await createCanvasDoc(wsRoot, {
      name: 'U',
      state: {
        nodes: [{ id: 'i1', type: 'image', position: { x: 0, y: 0 }, data: { filePath: '/x.png', fileName: 'x.png' } }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    await expect(updateCanvasNode(wsRoot, doc.id, 'i1', { text: 'nope' })).rejects.toThrow('Cannot set text')
  })
})

describe('addCanvasEdge', () => {
  async function docWithTwoNodes() {
    return createCanvasDoc(wsRoot, {
      name: 'E',
      state: {
        nodes: [
          { id: 'a', type: 'text', position: { x: 0, y: 0 }, data: { text: 'a' } },
          { id: 'b', type: 'text', position: { x: 1, y: 1 }, data: { text: 'b' } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
  }

  it('connects two existing nodes and bumps version', async () => {
    const doc = await docWithTwoNodes()
    const { doc: next, edgeId } = await addCanvasEdge(wsRoot, doc.id, { source: 'a', target: 'b' })
    expect(next.version).toBe(doc.version + 1)
    expect(next.edges).toHaveLength(1)
    expect(next.edges[0]).toEqual({ id: edgeId, source: 'a', target: 'b' })
  })

  it('throws when a node is missing', async () => {
    const doc = await docWithTwoNodes()
    await expect(addCanvasEdge(wsRoot, doc.id, { source: 'a', target: 'ghost' })).rejects.toThrow('not found')
  })

  it('rejects self-connection', async () => {
    const doc = await docWithTwoNodes()
    await expect(addCanvasEdge(wsRoot, doc.id, { source: 'a', target: 'a' })).rejects.toThrow('itself')
  })
})
