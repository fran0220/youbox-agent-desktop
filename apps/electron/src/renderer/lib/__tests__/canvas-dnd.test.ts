import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CANVAS_IMAGE_DND_MIME,
  dataTransferHasCanvasImage,
  imageNodeFromDrop,
  imageNodeFromImportedAsset,
  importRequestFromDrop,
  parseCanvasImageDrop,
  serializeCanvasImageDrag,
} from '../canvas-dnd'

/** Minimal DataTransfer.getData stub backed by a type→value map */
function dt(data: Record<string, string>) {
  return { getData: (type: string) => data[type] ?? '' }
}

describe('dataTransferHasCanvasImage', () => {
  it('detects the canvas-image MIME in the type list', () => {
    expect(dataTransferHasCanvasImage([CANVAS_IMAGE_DND_MIME, 'text/plain'])).toBe(true)
  })

  it('is false for unrelated or missing type lists', () => {
    expect(dataTransferHasCanvasImage(['text/plain'])).toBe(false)
    expect(dataTransferHasCanvasImage(undefined)).toBe(false)
    expect(dataTransferHasCanvasImage(null)).toBe(false)
  })
})

describe('parseCanvasImageDrop', () => {
  it('parses a JSON descriptor with filePath and fileName', () => {
    const ref = parseCanvasImageDrop(
      dt({ [CANVAS_IMAGE_DND_MIME]: serializeCanvasImageDrag({ filePath: '/a/b/cat.png', fileName: 'cat.png' }) }),
    )
    expect(ref).toEqual({ filePath: '/a/b/cat.png', fileName: 'cat.png' })
  })

  it('tolerates a bare path string payload', () => {
    const ref = parseCanvasImageDrop(dt({ [CANVAS_IMAGE_DND_MIME]: '  /a/b/dog.png  ' }))
    expect(ref).toEqual({ filePath: '/a/b/dog.png' })
  })

  it('returns null when the payload or file path is empty', () => {
    expect(parseCanvasImageDrop(dt({}))).toBeNull()
    expect(parseCanvasImageDrop(dt({ [CANVAS_IMAGE_DND_MIME]: '   ' }))).toBeNull()
    expect(parseCanvasImageDrop(dt({ [CANVAS_IMAGE_DND_MIME]: '{"filePath":""}' }))).toBeNull()
    expect(parseCanvasImageDrop(null)).toBeNull()
  })
})

describe('imageNodeFromDrop', () => {
  it('maps a dropped image ref + drop position to an image node', () => {
    const node = imageNodeFromDrop({ filePath: '/tmp/pics/frog.png' }, { x: 40, y: -12 })
    expect(node.type).toBe('image')
    expect(node.position).toEqual({ x: 40, y: -12 })
    expect(node.data.filePath).toBe('/tmp/pics/frog.png')
    expect(node.data.fileName).toBe('frog.png')
    expect(node.id).toBeTruthy()
  })
})

describe('importRequestFromDrop', () => {
  it('builds the canvas:importAsset request from a dropped ref', () => {
    const req = importRequestFromDrop(
      { filePath: '/ws/chat/attachments/cat.png', fileName: 'cat.png' },
      { workspaceId: 'ws-1', docId: 'doc-9' },
    )
    expect(req).toEqual({
      workspaceId: 'ws-1',
      docId: 'doc-9',
      sourcePath: '/ws/chat/attachments/cat.png',
    })
  })
})

describe('imageNodeFromImportedAsset', () => {
  it('points the node at the copied asset path and keeps the display name', () => {
    const node = imageNodeFromImportedAsset(
      '/ws/canvas/assets/doc-9/1a2b.png',
      { x: 5, y: 6 },
      'cat.png',
    )
    expect(node.type).toBe('image')
    expect(node.position).toEqual({ x: 5, y: 6 })
    expect(node.data.filePath).toBe('/ws/canvas/assets/doc-9/1a2b.png')
    expect(node.data.fileName).toBe('cat.png')
    expect(node.id).toBeTruthy()
  })

  it('falls back to the asset basename when no display name is given', () => {
    const node = imageNodeFromImportedAsset('/ws/canvas/assets/doc-9/1a2b.png', { x: 0, y: 0 })
    expect(node.data.fileName).toBe('1a2b.png')
  })

  it('ignores a blank display name', () => {
    const node = imageNodeFromImportedAsset('/ws/canvas/assets/doc-9/1a2b.png', { x: 0, y: 0 }, '   ')
    expect(node.data.fileName).toBe('1a2b.png')
  })
})

/**
 * MIME drift tripwire: packages/ui can't import from apps/electron, so the
 * chat-image drag source in UserMessageBubble.tsx hard-codes the MIME literal.
 * This asserts (1) the constant's value is pinned and (2) the UI drag source
 * still carries that exact literal — it fails loudly if either drifts.
 */
describe('CANVAS_IMAGE_DND_MIME sync', () => {
  it('pins the private MIME constant value', () => {
    expect(CANVAS_IMAGE_DND_MIME).toBe('application/x-origin-canvas-image')
  })

  it('matches the hard-coded literal in packages/ui UserMessageBubble.tsx', () => {
    const source = readFileSync(
      resolve(import.meta.dir, '../../../../../../packages/ui/src/components/chat/UserMessageBubble.tsx'),
      'utf8',
    )
    expect(source).toContain(`'${CANVAS_IMAGE_DND_MIME}'`)
  })
})
