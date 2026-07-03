import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import type { CanvasDocState } from '@craft-agent/shared/protocol'
import {
  CANVAS_SCHEMA_VERSION,
  createCanvasDoc,
  deleteCanvasDoc,
  ensureCanvasAssetsDir,
  getCanvasAssetsDir,
  getCanvasDocPath,
  getWorkspaceCanvasDir,
  isPathWithinCanvasAssets,
  isPathWithinWorkspace,
  listCanvasDocs,
  loadCanvasDoc,
  setCanvasDocChatSessionId,
  updateCanvasDoc,
} from './canvas-storage'

let wsRoot: string

beforeEach(() => {
  wsRoot = mkdtempSync(join(tmpdir(), 'canvas-storage-test-'))
})

afterEach(() => {
  rmSync(wsRoot, { recursive: true, force: true })
})

function sampleState(text = 'hello'): CanvasDocState {
  return {
    nodes: [
      { id: 'image-1', type: 'image', position: { x: 10, y: 20 }, data: { filePath: '/tmp/a.png', fileName: 'a.png' } },
      { id: 'text-1', type: 'text', position: { x: 30, y: 40 }, data: { text } },
    ],
    edges: [{ id: 'edge-1', source: 'text-1', target: 'image-1' }],
    viewport: { x: 1, y: 2, zoom: 1.5 },
  }
}

describe('canvas storage paths', () => {
  it('places docs and assets under <workspace>/canvas', () => {
    expect(getWorkspaceCanvasDir(wsRoot)).toBe(join(wsRoot, 'canvas'))
    expect(getCanvasDocPath(wsRoot, 'abc')).toBe(join(wsRoot, 'canvas', 'abc.json'))
    expect(getCanvasAssetsDir(wsRoot, 'abc')).toBe(join(wsRoot, 'canvas', 'assets', 'abc'))
  })

  it('rejects path-traversal doc ids', () => {
    expect(() => getCanvasDocPath(wsRoot, '../evil')).toThrow()
    expect(() => getCanvasDocPath(wsRoot, 'a/b')).toThrow()
    expect(() => getCanvasDocPath(wsRoot, '')).toThrow()
  })

  it('creates the assets dir lazily via ensureCanvasAssetsDir', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Assets' })
    expect(existsSync(getCanvasAssetsDir(wsRoot, doc.id))).toBe(false)
    const dir = ensureCanvasAssetsDir(wsRoot, doc.id)
    expect(dir).toBe(getCanvasAssetsDir(wsRoot, doc.id))
    expect(existsSync(dir)).toBe(true)
  })
})

describe('canvas doc CRUD round-trip', () => {
  it('create persists a schemaVersion-1 doc that loads back identically', async () => {
    const state = sampleState()
    const doc = await createCanvasDoc(wsRoot, { name: 'My Canvas', state })

    expect(doc.name).toBe('My Canvas')
    expect(doc.version).toBe(1)
    expect(doc.createdAt).toBeGreaterThan(0)
    expect(doc.updatedAt).toBe(doc.createdAt)
    expect(doc.nodes).toEqual(state.nodes)
    expect(doc.edges).toEqual(state.edges)
    expect(doc.viewport).toEqual(state.viewport)

    const raw = JSON.parse(readFileSync(getCanvasDocPath(wsRoot, doc.id), 'utf-8'))
    expect(raw.schemaVersion).toBe(CANVAS_SCHEMA_VERSION)

    const loaded = loadCanvasDoc(wsRoot, doc.id)
    expect(loaded).toEqual(doc)
  })

  it('create with no input yields an empty doc state', async () => {
    const doc = await createCanvasDoc(wsRoot)
    expect(doc.nodes).toEqual([])
    expect(doc.edges).toEqual([])
    expect(doc.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(doc.name.length).toBeGreaterThan(0)
  })

  it('load returns null for a missing doc', () => {
    expect(loadCanvasDoc(wsRoot, 'does-not-exist')).toBeNull()
  })

  it('list returns metas sorted by updatedAt desc, ignoring junk files', async () => {
    const a = await createCanvasDoc(wsRoot, { name: 'A' })
    await Bun.sleep(2)
    const b = await createCanvasDoc(wsRoot, { name: 'B' })
    await Bun.write(join(getWorkspaceCanvasDir(wsRoot), 'junk.txt'), 'not a doc')
    await Bun.write(join(getWorkspaceCanvasDir(wsRoot), 'broken.json'), '{oops')

    const metas = listCanvasDocs(wsRoot)
    expect(metas.map(m => m.id)).toEqual([b.id, a.id])
    expect(metas[0]).toEqual({ id: b.id, name: 'B', createdAt: b.createdAt, updatedAt: b.updatedAt, version: 1 })
  })

  it('list returns [] when the canvas dir does not exist', () => {
    expect(listCanvasDocs(wsRoot)).toEqual([])
  })

  it('update applies name/state, bumps version and updatedAt (last-write-wins)', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Before' })
    await Bun.sleep(2)

    const updated = await updateCanvasDoc(wsRoot, doc.id, { name: 'After', state: sampleState('world') })
    expect(updated.name).toBe('After')
    expect(updated.version).toBe(2)
    expect(updated.updatedAt).toBeGreaterThan(doc.updatedAt)
    expect(updated.createdAt).toBe(doc.createdAt)
    expect((updated.nodes[1] as { data: { text: string } }).data.text).toBe('world')

    // Last write wins: a second update fully replaces the previous state
    const final = await updateCanvasDoc(wsRoot, doc.id, { state: sampleState('final') })
    expect(final.version).toBe(3)
    expect(final.name).toBe('After')
    expect((loadCanvasDoc(wsRoot, doc.id)!.nodes[1] as { data: { text: string } }).data.text).toBe('final')
  })

  it('update throws for a missing doc', async () => {
    await expect(updateCanvasDoc(wsRoot, 'nope', { name: 'x' })).rejects.toThrow('not found')
  })

  it('delete removes the doc file and its assets dir', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Doomed' })
    ensureCanvasAssetsDir(wsRoot, doc.id)

    expect(await deleteCanvasDoc(wsRoot, doc.id)).toBe(true)
    expect(existsSync(getCanvasDocPath(wsRoot, doc.id))).toBe(false)
    expect(existsSync(getCanvasAssetsDir(wsRoot, doc.id))).toBe(false)
    expect(await deleteCanvasDoc(wsRoot, doc.id)).toBe(false)
  })
})

describe('reference-path workspace confinement (security)', () => {
  let outsideRoot: string

  beforeEach(() => {
    outsideRoot = mkdtempSync(join(tmpdir(), 'canvas-outside-'))
  })

  afterEach(() => {
    rmSync(outsideRoot, { recursive: true, force: true })
  })

  it('accepts a real asset inside the doc asset dir', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Refs' })
    const assetsDir = ensureCanvasAssetsDir(wsRoot, doc.id)
    const assetPath = join(assetsDir, 'in.png')
    writeFileSync(assetPath, 'png-bytes')

    expect(await isPathWithinWorkspace(wsRoot, assetPath)).toBe(true)
    expect(await isPathWithinCanvasAssets(wsRoot, doc.id, assetPath)).toBe(true)
  })

  it('rejects an absolute path outside the workspace', async () => {
    const outsideFile = join(outsideRoot, 'secret.txt')
    writeFileSync(outsideFile, 'top secret')

    expect(await isPathWithinWorkspace(wsRoot, outsideFile)).toBe(false)
  })

  it('rejects a traversal path that escapes the workspace after normalization', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Traverse' })
    const assetsDir = ensureCanvasAssetsDir(wsRoot, doc.id)
    const outsideFile = join(outsideRoot, 'escape.txt')
    writeFileSync(outsideFile, 'escaped')

    // e.g. <assets>/../../../../<outsideRoot>/escape.txt — resolves outside wsRoot
    const traversal = join(assetsDir, relative(assetsDir, outsideFile))
    expect(await isPathWithinWorkspace(wsRoot, traversal)).toBe(false)
  })

  it('rejects a symlink inside the asset dir that points outside the workspace', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Symlink' })
    const assetsDir = ensureCanvasAssetsDir(wsRoot, doc.id)
    const outsideFile = join(outsideRoot, 'target.txt')
    writeFileSync(outsideFile, 'linked secret')

    const link = join(assetsDir, 'link.png')
    symlinkSync(outsideFile, link)

    // The link itself lives inside the asset dir, but realpath resolves outside.
    expect(await isPathWithinWorkspace(wsRoot, link)).toBe(false)
    expect(await isPathWithinCanvasAssets(wsRoot, doc.id, link)).toBe(false)
  })

  it('rejects a non-existent path (nothing to read)', async () => {
    expect(await isPathWithinWorkspace(wsRoot, join(wsRoot, 'canvas', 'assets', 'x', 'nope.png'))).toBe(false)
    expect(await isPathWithinWorkspace(wsRoot, '')).toBe(false)
  })
})

describe('chatSessionId doc-metadata binding', () => {
  it('defaults to undefined and is omitted from the persisted JSON', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'NoSession' })
    expect(doc.chatSessionId).toBeUndefined()
    const raw = JSON.parse(readFileSync(getCanvasDocPath(wsRoot, doc.id), 'utf-8'))
    expect('chatSessionId' in raw).toBe(false)
  })

  it('binds a session id via a metadata-only write (no version/updatedAt bump) and round-trips', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Bind' })
    const bound = await setCanvasDocChatSessionId(wsRoot, doc.id, 'sess-123')

    expect(bound).not.toBeNull()
    expect(bound!.chatSessionId).toBe('sess-123')
    // Metadata-only: neither the content version nor updatedAt changed.
    expect(bound!.version).toBe(doc.version)
    expect(bound!.updatedAt).toBe(doc.updatedAt)

    const loaded = loadCanvasDoc(wsRoot, doc.id)!
    expect(loaded.chatSessionId).toBe('sess-123')
    expect(loaded.version).toBe(1)

    const metas = listCanvasDocs(wsRoot)
    expect(metas.find(m => m.id === doc.id)!.chatSessionId).toBe('sess-123')
  })

  it('preserves chatSessionId across a normal content update', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Persist' })
    await setCanvasDocChatSessionId(wsRoot, doc.id, 'sess-abc')

    const updated = await updateCanvasDoc(wsRoot, doc.id, { name: 'Renamed' })
    expect(updated.version).toBe(2)
    expect(updated.chatSessionId).toBe('sess-abc')
    expect(loadCanvasDoc(wsRoot, doc.id)!.chatSessionId).toBe('sess-abc')
  })

  it('unbinds when passed undefined', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Unbind' })
    await setCanvasDocChatSessionId(wsRoot, doc.id, 'sess-xyz')
    const cleared = await setCanvasDocChatSessionId(wsRoot, doc.id, undefined)
    expect(cleared!.chatSessionId).toBeUndefined()
    expect(loadCanvasDoc(wsRoot, doc.id)!.chatSessionId).toBeUndefined()
  })

  it('returns null for a missing doc', async () => {
    expect(await setCanvasDocChatSessionId(wsRoot, 'missing', 'sess')).toBeNull()
  })
})

describe('canvas storage atomicity and serialization', () => {
  it('a failed write leaves the previous doc intact and no .tmp behind', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Stable', state: sampleState('safe') })

    // BigInt is not JSON-serializable — serialization fails before any bytes hit disk
    const poisoned = {
      ...sampleState(),
      nodes: [{ id: 'n', type: 'text', position: { x: 0, y: 0 }, data: { text: 'x' }, poison: 1n }],
    } as unknown as CanvasDocState

    await expect(updateCanvasDoc(wsRoot, doc.id, { state: poisoned })).rejects.toThrow()

    const onDisk = JSON.parse(readFileSync(getCanvasDocPath(wsRoot, doc.id), 'utf-8'))
    expect(onDisk.version).toBe(1)
    expect(onDisk.nodes[1].data.text).toBe('safe')
    expect(readdirSync(getWorkspaceCanvasDir(wsRoot)).filter(f => f.endsWith('.tmp'))).toEqual([])
  })

  it('serializes concurrent updates per doc — every write lands, file stays valid JSON', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Contended' })

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => updateCanvasDoc(wsRoot, doc.id, { state: sampleState(`w${i}`) })),
    )

    const versions = results.map(r => r.version).sort((a, b) => a - b)
    expect(versions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

    const onDisk = loadCanvasDoc(wsRoot, doc.id)!
    expect(onDisk.version).toBe(11)
    // Last-write-wins: the state on disk is exactly the final writer's state
    const winner = results.find(r => r.version === 11)!
    expect(onDisk.nodes).toEqual(winner.nodes)
  })

  it('a failed queued write does not block subsequent writes to the same doc', async () => {
    const doc = await createCanvasDoc(wsRoot, { name: 'Recovers' })
    const poisoned = { ...sampleState(), viewport: { x: 1n } } as unknown as CanvasDocState

    await expect(updateCanvasDoc(wsRoot, doc.id, { state: poisoned })).rejects.toThrow()
    const after = await updateCanvasDoc(wsRoot, doc.id, { name: 'Recovered' })
    expect(after.name).toBe('Recovered')
    expect(loadCanvasDoc(wsRoot, doc.id)!.name).toBe('Recovered')
  })
})
