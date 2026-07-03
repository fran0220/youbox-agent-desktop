import { describe, expect, it } from 'bun:test'
import type { CanvasEdge, CanvasImageNode, CanvasNode, CanvasTextNode } from '@/atoms/canvas'
import {
  buildGenerationPrompt,
  collectReferenceNodeIds,
  collectSelectedTextContext,
  createPendingImageNode,
  isImageNodeGenerating,
  normalizeStalePendingNodes,
  serializeSelectionContext,
  setImageNodeError,
  setImageNodePending,
  setImageNodeReady,
} from '../canvas-generation'

function imageNode(id: string, data: Partial<CanvasImageNode['data']> = {}): CanvasImageNode {
  return {
    id,
    type: 'image',
    position: { x: 0, y: 0 },
    data: { filePath: `/tmp/${id}.png`, fileName: `${id}.png`, ...data },
  }
}

function textNode(id: string, text: string): CanvasTextNode {
  return { id, type: 'text', position: { x: 0, y: 0 }, data: { text } }
}

function edge(source: string, target: string): CanvasEdge {
  return { id: `${source}->${target}`, source, target }
}

describe('createPendingImageNode', () => {
  it('creates a pending image node carrying the prompt and references', () => {
    const node = createPendingImageNode('a cat', { x: 10, y: 20 }, ['image-a'])
    expect(node.type).toBe('image')
    expect(node.position).toEqual({ x: 10, y: 20 })
    expect(node.data.status).toBe('pending')
    expect(node.data.filePath).toBe('')
    expect(node.data.prompt).toBe('a cat')
    expect(node.data.referenceNodeIds).toEqual(['image-a'])
    expect(node.id.startsWith('image-')).toBe(true)
  })
})

describe('image node generation reducers', () => {
  const base: CanvasNode[] = [imageNode('img-1', { status: 'pending', prompt: 'p' }), textNode('txt-1', 'hi')]

  it('setImageNodePending resets to pending and clears prior error', () => {
    const errored = setImageNodeError(base, 'img-1', 'boom')
    const next = setImageNodePending(errored, 'img-1', { prompt: 'p2', referenceNodeIds: ['r1'] })
    const node = next.find((n) => n.id === 'img-1') as CanvasImageNode
    expect(node.data.status).toBe('pending')
    expect(node.data.error).toBeUndefined()
    expect(node.data.prompt).toBe('p2')
    expect(node.data.referenceNodeIds).toEqual(['r1'])
  })

  it('setImageNodeError marks the node as a retryable error', () => {
    const next = setImageNodeError(base, 'img-1', 'network down')
    const node = next.find((n) => n.id === 'img-1') as CanvasImageNode
    expect(node.data.status).toBe('error')
    expect(node.data.error).toBe('network down')
  })

  it('setImageNodeReady drops transient fields and commits the asset', () => {
    const next = setImageNodeReady(base, 'img-1', '/tmp/real.png', 'real.png')
    const node = next.find((n) => n.id === 'img-1') as CanvasImageNode
    expect(node.data).toEqual({ filePath: '/tmp/real.png', fileName: 'real.png' })
  })

  it('reducers ignore non-image and unknown ids', () => {
    expect(setImageNodeError(base, 'txt-1', 'x')).toEqual(base)
    expect(setImageNodeReady(base, 'missing', '/a', 'a').length).toBe(base.length)
  })
})

describe('isImageNodeGenerating', () => {
  const nodes: CanvasNode[] = [
    imageNode('img-pending', { status: 'pending' }),
    imageNode('img-error', { status: 'error', error: 'boom' }),
    imageNode('img-ready'),
    textNode('txt', 'note'),
  ]

  it('is true only while an image node generation is pending (in flight)', () => {
    expect(isImageNodeGenerating(nodes, 'img-pending')).toBe(true)
  })

  it('is false for errored, committed, text, and unknown nodes', () => {
    expect(isImageNodeGenerating(nodes, 'img-error')).toBe(false)
    expect(isImageNodeGenerating(nodes, 'img-ready')).toBe(false)
    expect(isImageNodeGenerating(nodes, 'txt')).toBe(false)
    expect(isImageNodeGenerating(nodes, 'missing')).toBe(false)
  })

  it('flips to guarded once a retry marks the node pending', () => {
    // Retry path: node starts errored (guard open), then markPending closes it.
    expect(isImageNodeGenerating(nodes, 'img-error')).toBe(false)
    const pending = setImageNodePending(nodes, 'img-error')
    expect(isImageNodeGenerating(pending, 'img-error')).toBe(true)
  })
})

describe('normalizeStalePendingNodes', () => {
  it('converts persisted pending nodes into errors, preserving prompt', () => {
    const nodes: CanvasNode[] = [imageNode('img-1', { status: 'pending', prompt: 'keep', filePath: '' })]
    const next = normalizeStalePendingNodes(nodes)
    const node = next[0] as CanvasImageNode
    expect(node.data.status).toBe('error')
    expect(node.data.prompt).toBe('keep')
  })

  it('returns the same array reference when nothing is pending', () => {
    const nodes: CanvasNode[] = [imageNode('img-1'), textNode('t', 'x')]
    expect(normalizeStalePendingNodes(nodes)).toBe(nodes)
  })
})

describe('collectReferenceNodeIds', () => {
  const nodes: CanvasNode[] = [
    imageNode('img-a'),
    imageNode('img-b'),
    textNode('txt-a', 'note'),
    imageNode('img-up'),
  ]

  it('includes selected image nodes but not selected text nodes', () => {
    expect(collectReferenceNodeIds(nodes, [], ['img-a', 'txt-a'])).toEqual(['img-a'])
  })

  it('includes image nodes wired upstream of a selected node', () => {
    const edges = [edge('img-up', 'txt-a')]
    expect(collectReferenceNodeIds(nodes, edges, ['txt-a'])).toEqual(['img-up'])
  })

  it('de-duplicates and keeps selection before upstream', () => {
    const edges = [edge('img-a', 'img-b'), edge('img-up', 'img-b')]
    expect(collectReferenceNodeIds(nodes, edges, ['img-b', 'img-a'])).toEqual(['img-b', 'img-a', 'img-up'])
  })

  it('ignores upstream sources that are not image nodes', () => {
    const edges = [edge('txt-a', 'img-b')]
    expect(collectReferenceNodeIds(nodes, edges, ['img-b'])).toEqual(['img-b'])
  })
})

describe('collectSelectedTextContext', () => {
  it('returns trimmed, non-empty text of selected text nodes only', () => {
    const nodes: CanvasNode[] = [textNode('t1', '  hello '), textNode('t2', '   '), imageNode('i1')]
    expect(collectSelectedTextContext(nodes, ['t1', 't2', 'i1'])).toEqual(['hello'])
  })
})

describe('buildGenerationPrompt', () => {
  it('returns the trimmed prompt when there is no text context', () => {
    expect(buildGenerationPrompt('  a dog ', [])).toBe('a dog')
  })

  it('appends text context blocks after the prompt', () => {
    expect(buildGenerationPrompt('a dog', ['big', 'brown'])).toBe('a dog\n\nbig\n\nbrown')
  })
})

describe('serializeSelectionContext', () => {
  it('serializes text notes and image references', () => {
    const nodes: CanvasNode[] = [
      textNode('t1', 'the brief'),
      imageNode('i1', { fileName: 'ref.png', prompt: 'sunset' }),
      imageNode('i2', { fileName: 'plain.png' }),
    ]
    expect(serializeSelectionContext(nodes)).toBe(
      '- Note: the brief\n- Image "ref.png" (prompt: sunset)\n- Image: plain.png',
    )
  })

  it('returns an empty string for an empty selection', () => {
    expect(serializeSelectionContext([])).toBe('')
  })
})
