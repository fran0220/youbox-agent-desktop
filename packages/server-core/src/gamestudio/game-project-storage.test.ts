import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  GAME_PROJECT_SCHEMA_VERSION,
  createGameProject,
  deleteGameProject,
  getGameProjectDir,
  getGameProjectMetaPath,
  getWorkspaceGameStudioDir,
  listGameProjects,
  loadGameProject,
  updateGameProject,
} from './game-project-storage'

let wsRoot: string
let resourcesRoot: string

beforeEach(() => {
  wsRoot = mkdtempSync(join(tmpdir(), 'game-project-storage-test-'))
  resourcesRoot = mkdtempSync(join(tmpdir(), 'game-project-resources-test-'))
  const vendorDir = join(resourcesRoot, 'gamestudio', 'vendor')
  mkdirSync(vendorDir, { recursive: true })
  writeFileSync(join(resourcesRoot, 'sentinel'), 'resources-root')
  writeFileSync(join(vendorDir, 'three.module.js'), 'export const REVISION = "test-three";')
  writeFileSync(join(vendorDir, 'rapier.es.js'), 'export default async function init() {}')
})

afterEach(() => {
  rmSync(wsRoot, { recursive: true, force: true })
  rmSync(resourcesRoot, { recursive: true, force: true })
})

describe('game project storage paths', () => {
  it('places projects under <workspace>/gamestudio/<projectId>', () => {
    expect(getWorkspaceGameStudioDir(wsRoot)).toBe(join(wsRoot, 'gamestudio'))
    expect(getGameProjectDir(wsRoot, 'abc')).toBe(join(wsRoot, 'gamestudio', 'abc'))
    expect(getGameProjectMetaPath(wsRoot, 'abc')).toBe(join(wsRoot, 'gamestudio', 'abc', 'project.json'))
  })

  it('rejects path-traversal project ids', () => {
    expect(() => getGameProjectDir(wsRoot, '../evil')).toThrow()
    expect(() => getGameProjectDir(wsRoot, 'a/b')).toThrow()
    expect(() => getGameProjectDir(wsRoot, '/tmp/evil')).toThrow()
    expect(() => getGameProjectDir(wsRoot, '')).toThrow()
  })
})

describe('game project scaffold and CRUD', () => {
  it('create scaffolds project.json, index.html, src/main.js and vendored runtime files', async () => {
    const project = await createGameProject(wsRoot, { name: 'My Game' }, { resourcesRoot })
    const projectDir = getGameProjectDir(wsRoot, project.id)

    expect(project.name).toBe('My Game')
    expect(project.sessionId).toBeNull()
    expect(project.thumbnailPath).toBeNull()
    expect(project.lastPlayableCommit).toEqual(expect.any(String))
    expect(project.lastGeneratedCommit).toBe(project.lastPlayableCommit)
    expect(project.lastError).toBeNull()
    expect(project.version).toBe(1)
    expect(project.updatedAt).toBe(project.createdAt)

    expect(existsSync(getGameProjectMetaPath(wsRoot, project.id))).toBe(true)
    expect(existsSync(join(projectDir, 'index.html'))).toBe(true)
    expect(existsSync(join(projectDir, 'src', 'main.js'))).toBe(true)
    expect(existsSync(join(projectDir, 'gameblocks_usage.md'))).toBe(true)
    expect(existsSync(join(projectDir, '.agents', 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(projectDir, '.git'))).toBe(true)
    expect(existsSync(join(projectDir, 'vendor', 'three.module.js'))).toBe(true)
    expect(existsSync(join(projectDir, 'vendor', 'rapier.es.js'))).toBe(true)

    const raw = JSON.parse(readFileSync(getGameProjectMetaPath(wsRoot, project.id), 'utf-8'))
    expect(raw.schemaVersion).toBe(GAME_PROJECT_SCHEMA_VERSION)
    expect(raw.id).toBe(project.id)
    expect(raw.name).toBe('My Game')
    expect(raw.sessionId).toBeNull()
    expect(raw.thumbnailPath).toBeNull()
    expect(raw.lastPlayableCommit).toBe(project.lastPlayableCommit)
    expect(raw.lastGeneratedCommit).toBe(project.lastGeneratedCommit)
    expect(raw.lastError).toBeNull()

    const html = readFileSync(join(projectDir, 'index.html'), 'utf-8')
    expect(html).toContain('<script type="importmap">')
    expect(html).toContain('"three": "./vendor/three.module.js"')
    expect(html).toContain('type="module" src="./src/main.js"')

    const main = readFileSync(join(projectDir, 'src', 'main.js'), 'utf-8')
    expect(main).toContain("from 'three'")
    expect(main).toContain('BoxGeometry')

    expect(readFileSync(join(projectDir, 'vendor', 'three.module.js'), 'utf-8')).toContain('test-three')
  })

  it('load returns the created project and list returns metas sorted by updatedAt desc', async () => {
    const a = await createGameProject(wsRoot, { name: 'A' }, { resourcesRoot })
    await Bun.sleep(2)
    const b = await createGameProject(wsRoot, { name: 'B' }, { resourcesRoot })
    await Bun.write(join(getWorkspaceGameStudioDir(wsRoot), 'junk.txt'), 'not a project')
    await Bun.write(join(getWorkspaceGameStudioDir(wsRoot), 'broken', 'project.json'), '{oops')

    expect(loadGameProject(wsRoot, a.id)).toEqual(a)
    const metas = listGameProjects(wsRoot)
    expect(metas.map(m => m.id)).toEqual([b.id, a.id])
    expect(metas[0]).toEqual({
      id: b.id,
      name: 'B',
      sessionId: null,
      thumbnailPath: null,
      lastPlayableCommit: b.lastPlayableCommit,
      lastGeneratedCommit: b.lastGeneratedCommit,
      lastError: null,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      version: 1,
    })
  })

  it('update applies metadata, bumps version and updatedAt, preserving createdAt', async () => {
    const project = await createGameProject(wsRoot, { name: 'Before' }, { resourcesRoot })
    await Bun.sleep(2)

    const updated = await updateGameProject(wsRoot, project.id, { name: 'After', sessionId: 'sess-1' })
    expect(updated.name).toBe('After')
    expect(updated.sessionId).toBe('sess-1')
    expect(updated.version).toBe(2)
    expect(updated.updatedAt).toBeGreaterThan(project.updatedAt)
    expect(updated.createdAt).toBe(project.createdAt)
    expect(loadGameProject(wsRoot, project.id)).toEqual(updated)

    const cleared = await updateGameProject(wsRoot, project.id, { sessionId: null })
    expect(cleared.sessionId).toBeNull()
    expect(cleared.version).toBe(3)
  })

  it('delete recursively removes the whole project directory without touching siblings', async () => {
    const a = await createGameProject(wsRoot, { name: 'A' }, { resourcesRoot })
    const b = await createGameProject(wsRoot, { name: 'B' }, { resourcesRoot })
    await Bun.write(join(getGameProjectDir(wsRoot, a.id), 'src', 'marker.txt'), 'keep')

    expect(await deleteGameProject(wsRoot, b.id)).toBe(true)
    expect(existsSync(getGameProjectDir(wsRoot, b.id))).toBe(false)
    expect(readFileSync(join(getGameProjectDir(wsRoot, a.id), 'src', 'marker.txt'), 'utf-8')).toBe('keep')
    expect(await deleteGameProject(wsRoot, b.id)).toBe(false)
  })
})

describe('game project storage atomicity and serialization', () => {
  it('a failed write leaves the previous project intact and no .tmp behind', async () => {
    const project = await createGameProject(wsRoot, { name: 'Stable' }, { resourcesRoot })
    await expect(updateGameProject(wsRoot, project.id, { name: 1n as unknown as string })).rejects.toThrow()

    const onDisk = JSON.parse(readFileSync(getGameProjectMetaPath(wsRoot, project.id), 'utf-8'))
    expect(onDisk.version).toBe(1)
    expect(onDisk.name).toBe('Stable')
    expect(readdirSync(getGameProjectDir(wsRoot, project.id)).filter(f => f.endsWith('.tmp'))).toEqual([])
  })

  it('serializes concurrent updates per project so every version lands', async () => {
    const project = await createGameProject(wsRoot, { name: 'Contended' }, { resourcesRoot })
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => updateGameProject(wsRoot, project.id, { name: `w${i}` })),
    )

    const versions = results.map(r => r.version).sort((a, b) => a - b)
    expect(versions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    const onDisk = loadGameProject(wsRoot, project.id)!
    expect(onDisk.version).toBe(11)
    expect(onDisk.name).toBe(results.find(r => r.version === 11)!.name)
  })
})
