import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  addCanvasNodeAtom,
  applyCanvasNodeChangesAtom,
  canvasDocStateAtom,
  canvasEdgesAtom,
  canvasNodesAtom,
  canvasViewportAtom,
  connectCanvasEdgeAtom,
  createImageNode,
  createTextNode,
  deserializeCanvasDocState,
  hydrateCanvasDocAtom,
  serializeCanvasDocState,
  type CanvasDocState,
} from '../canvas'

function buildDocState(): CanvasDocState {
  const store = createStore()
  const img = createImageNode('/tmp/pics/cat.png', { x: 10, y: 20 })
  const txt = createTextNode({ x: 100, y: 200 }, 'note')
  store.set(addCanvasNodeAtom, img)
  store.set(addCanvasNodeAtom, txt)
  store.set(connectCanvasEdgeAtom, {
    source: img.id,
    target: txt.id,
    sourceHandle: null,
    targetHandle: null,
  })
  store.set(canvasViewportAtom, { x: -50, y: 25, zoom: 1.75 })
  return store.get(canvasDocStateAtom)
}

describe('serializeCanvasDocState', () => {
  it('preserves nodes, edges and viewport', () => {
    const state = buildDocState()
    const dto = serializeCanvasDocState(state)

    expect(dto.nodes).toHaveLength(2)
    expect(dto.nodes[0]?.type).toBe('image')
    expect(dto.nodes[0]?.data).toEqual({ filePath: '/tmp/pics/cat.png', fileName: 'cat.png' })
    expect(dto.nodes[1]?.type).toBe('text')
    expect(dto.nodes[1]?.data).toEqual({ text: 'note' })
    expect(dto.edges).toHaveLength(1)
    expect(dto.viewport).toEqual({ x: -50, y: 25, zoom: 1.75 })
  })

  it('strips volatile selection/drag flags from nodes and edges', () => {
    const store = createStore()
    const node = createTextNode({ x: 0, y: 0 }, 'x')
    store.set(addCanvasNodeAtom, node)
    store.set(applyCanvasNodeChangesAtom, [{ id: node.id, type: 'select', selected: true }])
    store.set(canvasEdgesAtom, [
      { id: 'e1', source: 'a', target: 'b', selected: true },
    ])

    const dto = serializeCanvasDocState(store.get(canvasDocStateAtom))
    expect('selected' in dto.nodes[0]!).toBe(false)
    expect('dragging' in dto.nodes[0]!).toBe(false)
    expect('selected' in dto.edges[0]!).toBe(false)
  })

  it('produces identical output for states differing only in selection (no-op save detection)', () => {
    const store = createStore()
    const node = createTextNode({ x: 0, y: 0 }, 'same')
    store.set(addCanvasNodeAtom, node)
    const before = JSON.stringify(serializeCanvasDocState(store.get(canvasDocStateAtom)))

    store.set(applyCanvasNodeChangesAtom, [{ id: node.id, type: 'select', selected: true }])
    const after = JSON.stringify(serializeCanvasDocState(store.get(canvasDocStateAtom)))

    expect(after).toBe(before)
  })
})

describe('hydrate/serialize round-trip', () => {
  it('hydrateCanvasDocAtom replaces nodes, edges and viewport wholesale', () => {
    const store = createStore()
    store.set(addCanvasNodeAtom, createTextNode({ x: 1, y: 1 }, 'stale'))

    const incoming = buildDocState()
    store.set(hydrateCanvasDocAtom, incoming)

    expect(store.get(canvasNodesAtom)).toEqual(incoming.nodes)
    expect(store.get(canvasEdgesAtom)).toEqual(incoming.edges)
    expect(store.get(canvasViewportAtom)).toEqual(incoming.viewport)
  })

  it('serialize → deserialize → hydrate → serialize is the identity on the wire shape', () => {
    const state = buildDocState()
    const wire = serializeCanvasDocState(state)

    const store = createStore()
    store.set(hydrateCanvasDocAtom, deserializeCanvasDocState(wire))
    const roundTripped = serializeCanvasDocState(store.get(canvasDocStateAtom))

    expect(JSON.stringify(roundTripped)).toBe(JSON.stringify(wire))
  })
})
