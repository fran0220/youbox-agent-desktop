import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'
import { createCanvasDoc, ensureCanvasAssetsDir, getCanvasAssetsDir, loadCanvasDoc } from './canvas-storage'
import { importCanvasAsset } from './canvas-asset-service'

// base64 of "hello" — a few valid bytes to stand in for image content
const IMG_BYTES = Buffer.from('aGVsbG8=', 'base64')

let wsRoot: string
let outsideRoot: string

beforeEach(() => {
  wsRoot = mkdtempSync(join(tmpdir(), 'canvas-asset-ws-'))
  outsideRoot = mkdtempSync(join(tmpdir(), 'canvas-asset-outside-'))
})

afterEach(() => {
  rmSync(wsRoot, { recursive: true, force: true })
  rmSync(outsideRoot, { recursive: true, force: true })
})

describe('importCanvasAsset — happy path', () => {
  it('copies an in-workspace image into canvas/assets/{docId}/ with a fresh name, without mutating the doc', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Import' })
    const source = join(wsRoot, 'dropped.png')
    writeFileSync(source, IMG_BYTES)

    const result = await importCanvasAsset(wsRoot, { docId: doc.id, sourcePath: source })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Lands under the per-doc asset dir with a fresh (uuid) basename + original ext.
    expect(dirname(result.assetPath)).toBe(getCanvasAssetsDir(wsRoot, doc.id))
    expect(result.assetPath.endsWith('.png')).toBe(true)
    expect(result.fileName).not.toBe('dropped.png')
    expect(result.fileName.endsWith('.png')).toBe(true)
    expect(existsSync(result.assetPath)).toBe(true)

    // Doc is NOT mutated — the renderer creates the node.
    const stored = loadCanvasDoc(wsRoot, doc.id)!
    expect(stored.nodes).toEqual([])
    expect(stored.version).toBe(doc.version)
  })

  it('preserves a .jpeg extension', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Jpeg' })
    const source = join(wsRoot, 'photo.jpeg')
    writeFileSync(source, IMG_BYTES)

    const result = await importCanvasAsset(wsRoot, { docId: doc.id, sourcePath: source })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.fileName.endsWith('.jpeg')).toBe(true)
  })
})

describe('importCanvasAsset — rejections', () => {
  it('rejects a missing doc with doc_not_found', async () => {
    const source = join(wsRoot, 'a.png')
    writeFileSync(source, IMG_BYTES)
    const result = await importCanvasAsset(wsRoot, { docId: 'no-such-doc', sourcePath: source })
    expect(result).toMatchObject({ ok: false, code: 'doc_not_found' })
  })

  it('rejects a non-existent source with source_not_found', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Missing' })
    const result = await importCanvasAsset(wsRoot, { docId: doc.id, sourcePath: join(wsRoot, 'nope.png') })
    expect(result).toMatchObject({ ok: false, code: 'source_not_found' })
  })

  it('rejects an out-of-workspace absolute path with forbidden_path', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Outside' })
    const outside = join(outsideRoot, 'secret.png')
    writeFileSync(outside, IMG_BYTES)

    const result = await importCanvasAsset(wsRoot, { docId: doc.id, sourcePath: outside })
    expect(result).toMatchObject({ ok: false, code: 'forbidden_path' })
  })

  it('rejects a traversal path that escapes the workspace with forbidden_path', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Traverse' })
    const outside = join(outsideRoot, 'escape.png')
    writeFileSync(outside, IMG_BYTES)
    const traversal = join(wsRoot, relative(wsRoot, outside))

    const result = await importCanvasAsset(wsRoot, { docId: doc.id, sourcePath: traversal })
    expect(result).toMatchObject({ ok: false, code: 'forbidden_path' })
  })

  it('rejects a symlink inside the workspace pointing outside with forbidden_path', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Symlink' })
    ensureCanvasAssetsDir(wsRoot, doc.id)
    const outside = join(outsideRoot, 'target.png')
    writeFileSync(outside, IMG_BYTES)
    const link = join(wsRoot, 'link.png')
    symlinkSync(outside, link)

    const result = await importCanvasAsset(wsRoot, { docId: doc.id, sourcePath: link })
    expect(result).toMatchObject({ ok: false, code: 'forbidden_path' })
  })

  it('rejects a non-image extension with invalid_image', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'NotImage' })
    const source = join(wsRoot, 'notes.txt')
    writeFileSync(source, 'hello')

    const result = await importCanvasAsset(wsRoot, { docId: doc.id, sourcePath: source })
    expect(result).toMatchObject({ ok: false, code: 'invalid_image' })
  })

  it('rejects an oversize image with invalid_image', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Big' })
    const source = join(wsRoot, 'big.png')
    writeFileSync(source, Buffer.alloc(2048))

    const result = await importCanvasAsset(wsRoot, { docId: doc.id, sourcePath: source }, { maxBytes: 1024 })
    expect(result).toMatchObject({ ok: false, code: 'invalid_image' })
  })
})
