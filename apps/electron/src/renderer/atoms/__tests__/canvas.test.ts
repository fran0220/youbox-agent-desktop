import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { Connection } from '@xyflow/react'
import {
  addCanvasNodeAtom,
  applyCanvasEdgeChangesAtom,
  applyCanvasNodeChangesAtom,
  canvasDocStateAtom,
  canvasEdgesAtom,
  canvasNodesAtom,
  canvasViewportAtom,
  canvasChatSessionIdsAtom,
  connectCanvasEdgeAtom,
  createImageNode,
  createTextNode,
  isValidCanvasConnection,
  seedCanvasChatSessionIdAtom,
  selectedCanvasNodeIdsAtom,
  setTextNodeTextAtom,
  type CanvasEdge,
} from '../canvas'

function connection(source: string, target: string, overrides?: Partial<Connection>): Connection {
  return { source, target, sourceHandle: null, targetHandle: null, ...overrides }
}

describe('canvas node factories', () => {
  it('creates an image node with type, position and file metadata', () => {
    const node = createImageNode('/tmp/pics/cat photo.png', { x: 10, y: 20 })
    expect(node.type).toBe('image')
    expect(node.position).toEqual({ x: 10, y: 20 })
    expect(node.data.filePath).toBe('/tmp/pics/cat photo.png')
    expect(node.data.fileName).toBe('cat photo.png')
    expect(node.id).toBeTruthy()
  })

  it('derives fileName from Windows-style paths too', () => {
    const node = createImageNode('C:\\Users\\foo\\img.png', { x: 0, y: 0 })
    expect(node.data.fileName).toBe('img.png')
  })

  it('creates a text node with empty text by default and unique ids', () => {
    const a = createTextNode({ x: 0, y: 0 })
    const b = createTextNode({ x: 0, y: 0 }, 'hello')
    expect(a.type).toBe('text')
    expect(a.data.text).toBe('')
    expect(b.data.text).toBe('hello')
    expect(a.id).not.toBe(b.id)
  })
})

describe('isValidCanvasConnection', () => {
  const existing: CanvasEdge[] = [
    { id: 'e1', source: 'a', target: 'b', sourceHandle: null, targetHandle: null },
  ]

  it('accepts a new connection between two distinct nodes', () => {
    expect(isValidCanvasConnection(connection('a', 'c'), existing)).toBe(true)
  })

  it('rejects self-loops', () => {
    expect(isValidCanvasConnection(connection('a', 'a'), existing)).toBe(false)
  })

  it('rejects connections missing source or target', () => {
    expect(isValidCanvasConnection(connection('', 'b'), existing)).toBe(false)
    expect(isValidCanvasConnection(connection('a', ''), existing)).toBe(false)
  })

  it('rejects duplicates of an existing edge (same endpoints + handles)', () => {
    expect(isValidCanvasConnection(connection('a', 'b'), existing)).toBe(false)
  })

  it('treats undefined and null handles as equivalent when deduplicating', () => {
    expect(isValidCanvasConnection({ source: 'a', target: 'b' } as Connection, existing)).toBe(false)
  })

  it('allows same endpoints via a different handle pair', () => {
    expect(
      isValidCanvasConnection(connection('a', 'b', { sourceHandle: 'alt' }), existing),
    ).toBe(true)
  })
})

describe('canvas atoms', () => {
  it('addCanvasNodeAtom appends nodes', () => {
    const store = createStore()
    const img = createImageNode('/tmp/a.png', { x: 0, y: 0 })
    const txt = createTextNode({ x: 50, y: 50 })
    store.set(addCanvasNodeAtom, img)
    store.set(addCanvasNodeAtom, txt)
    expect(store.get(canvasNodesAtom).map((n) => n.id)).toEqual([img.id, txt.id])
  })

  it('applyCanvasNodeChangesAtom applies position changes', () => {
    const store = createStore()
    const node = createTextNode({ x: 0, y: 0 })
    store.set(addCanvasNodeAtom, node)

    store.set(applyCanvasNodeChangesAtom, [
      { id: node.id, type: 'position', position: { x: 120, y: -30 } },
    ])

    expect(store.get(canvasNodesAtom)[0]?.position).toEqual({ x: 120, y: -30 })
  })

  it('applyCanvasNodeChangesAtom applies select + remove changes and selection derives', () => {
    const store = createStore()
    const a = createTextNode({ x: 0, y: 0 })
    const b = createTextNode({ x: 10, y: 10 })
    store.set(addCanvasNodeAtom, a)
    store.set(addCanvasNodeAtom, b)

    store.set(applyCanvasNodeChangesAtom, [{ id: a.id, type: 'select', selected: true }])
    expect(store.get(selectedCanvasNodeIdsAtom)).toEqual([a.id])

    store.set(applyCanvasNodeChangesAtom, [{ id: a.id, type: 'remove' }])
    expect(store.get(canvasNodesAtom).map((n) => n.id)).toEqual([b.id])
    expect(store.get(selectedCanvasNodeIdsAtom)).toEqual([])
  })

  it('connectCanvasEdgeAtom adds valid edges and ignores invalid ones', () => {
    const store = createStore()

    store.set(connectCanvasEdgeAtom, connection('a', 'b'))
    expect(store.get(canvasEdgesAtom)).toHaveLength(1)

    // duplicate
    store.set(connectCanvasEdgeAtom, connection('a', 'b'))
    // self-loop
    store.set(connectCanvasEdgeAtom, connection('a', 'a'))
    expect(store.get(canvasEdgesAtom)).toHaveLength(1)

    store.set(connectCanvasEdgeAtom, connection('b', 'a'))
    expect(store.get(canvasEdgesAtom)).toHaveLength(2)
  })

  it('applyCanvasEdgeChangesAtom removes edges', () => {
    const store = createStore()
    store.set(connectCanvasEdgeAtom, connection('a', 'b'))
    const edgeId = store.get(canvasEdgesAtom)[0]!.id

    store.set(applyCanvasEdgeChangesAtom, [{ id: edgeId, type: 'remove' }])
    expect(store.get(canvasEdgesAtom)).toHaveLength(0)
  })

  it('setTextNodeTextAtom updates only the targeted text node', () => {
    const store = createStore()
    const txt = createTextNode({ x: 0, y: 0 }, 'before')
    const img = createImageNode('/tmp/a.png', { x: 0, y: 0 })
    store.set(addCanvasNodeAtom, txt)
    store.set(addCanvasNodeAtom, img)

    store.set(setTextNodeTextAtom, { id: txt.id, text: 'after' })
    store.set(setTextNodeTextAtom, { id: img.id, text: 'ignored' })

    const nodes = store.get(canvasNodesAtom)
    expect(nodes[0]?.type === 'text' && nodes[0].data.text).toBe('after')
    expect(nodes[1]?.type === 'image' && nodes[1].data.filePath).toBe('/tmp/a.png')
  })

  it('seedCanvasChatSessionIdAtom hydrates the cache from doc metadata, ignoring empty binds', () => {
    const store = createStore()

    // No persisted binding — cache stays empty.
    store.set(seedCanvasChatSessionIdAtom, { docId: 'doc-1', sessionId: undefined })
    expect(store.get(canvasChatSessionIdsAtom)).toEqual({})

    store.set(seedCanvasChatSessionIdAtom, { docId: 'doc-1', sessionId: 'sess-1' })
    expect(store.get(canvasChatSessionIdsAtom)).toEqual({ 'doc-1': 'sess-1' })

    // Re-seeding the same value is a no-op (same object reference).
    const before = store.get(canvasChatSessionIdsAtom)
    store.set(seedCanvasChatSessionIdAtom, { docId: 'doc-1', sessionId: 'sess-1' })
    expect(store.get(canvasChatSessionIdsAtom)).toBe(before)

    // Metadata wins on a differing persisted id.
    store.set(seedCanvasChatSessionIdAtom, { docId: 'doc-1', sessionId: 'sess-2' })
    expect(store.get(canvasChatSessionIdsAtom)).toEqual({ 'doc-1': 'sess-2' })
  })

  it('canvasDocStateAtom mirrors nodes, edges and viewport (M2 serialization shape)', () => {
    const store = createStore()
    const node = createTextNode({ x: 1, y: 2 }, 'doc')
    store.set(addCanvasNodeAtom, node)
    store.set(connectCanvasEdgeAtom, connection('x', 'y'))
    store.set(canvasViewportAtom, { x: 5, y: 6, zoom: 1.5 })

    const doc = store.get(canvasDocStateAtom)
    expect(doc.nodes).toHaveLength(1)
    expect(doc.edges).toHaveLength(1)
    expect(doc.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 })
  })
})
