import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DESIGN_PROJECT_SCHEMA_VERSION,
  createDesignProject,
  deleteDesignProject,
  getDesignProjectDir,
  getDesignProjectMetaPath,
  getWorkspaceDesignDir,
  listDesignProjects,
  loadDesignProject,
  updateDesignProject,
} from './design-project-storage'

let wsRoot: string
let resourcesRoot: string

beforeEach(() => {
  wsRoot = mkdtempSync(join(tmpdir(), 'design-project-storage-test-'))
  resourcesRoot = mkdtempSync(join(tmpdir(), 'design-project-resources-test-'))
  writeDesignResourcesFixture(resourcesRoot)
})

afterEach(() => {
  rmSync(wsRoot, { recursive: true, force: true })
  rmSync(resourcesRoot, { recursive: true, force: true })
})

function writeDesignResourcesFixture(root: string) {
  const designRoot = join(root, 'design')
  const templateDir = join(designRoot, 'templates', 'deck-template')
  const systemDir = join(designRoot, 'design-systems', 'system-one')
  mkdirSync(join(templateDir, 'slides'), { recursive: true })
  mkdirSync(join(templateDir, 'assets'), { recursive: true })
  mkdirSync(systemDir, { recursive: true })
  writeFileSync(join(templateDir, 'template.json'), JSON.stringify({
    id: 'deck-template',
    name: 'Deck Template',
    kind: 'deck',
    entryFile: 'slides/index.html',
    description: 'A deck template.',
  }))
  writeFileSync(join(templateDir, 'slides', 'index.html'), '<!doctype html><h1>Template first slide</h1>')
  writeFileSync(join(templateDir, 'assets', 'theme.css'), 'body{color:rebeccapurple}')
  writeFileSync(join(systemDir, 'DESIGN.md'), '# System One\n\nUse sharp layouts.')
  writeFileSync(join(designRoot, 'manifest.json'), JSON.stringify({
    templates: [{
      id: 'deck-template',
      name: 'Deck Template',
      kind: 'deck',
      entryFile: 'slides/index.html',
      description: 'A deck template.',
    }],
    designSystems: [{
      id: 'system-one',
      name: 'System One',
      description: 'System fixture.',
      path: 'design-systems/system-one/DESIGN.md',
    }],
    skills: [],
  }))
}

describe('design project storage paths', () => {
  it('places projects under <workspace>/design/<projectId>', () => {
    expect(getWorkspaceDesignDir(wsRoot)).toBe(join(wsRoot, 'design'))
    expect(getDesignProjectDir(wsRoot, 'abc')).toBe(join(wsRoot, 'design', 'abc'))
    expect(getDesignProjectMetaPath(wsRoot, 'abc')).toBe(join(wsRoot, 'design', 'abc', 'project.json'))
  })

  it('rejects path-traversal project ids', () => {
    expect(() => getDesignProjectDir(wsRoot, '../evil')).toThrow()
    expect(() => getDesignProjectDir(wsRoot, 'a/b')).toThrow()
    expect(() => getDesignProjectDir(wsRoot, '/tmp/evil')).toThrow()
    expect(() => getDesignProjectDir(wsRoot, '')).toThrow()
  })
})

describe('design project scaffold and CRUD', () => {
  it('create scaffolds project.json, placeholder index.html and assets directory', async () => {
    const project = await createDesignProject(wsRoot, { name: 'My Prototype' })
    const projectDir = getDesignProjectDir(wsRoot, project.id)

    expect(project.name).toBe('My Prototype')
    expect(project.kind).toBe('prototype')
    expect(project.entryFile).toBe('index.html')
    expect(project.sessionId).toBeNull()
    expect(project.designSystemId).toBeNull()
    expect(project.templateId).toBeNull()
    expect(project.thumbnailPath).toBeNull()
    expect(project.version).toBe(1)
    expect(project.updatedAt).toBe(project.createdAt)

    expect(existsSync(getDesignProjectMetaPath(wsRoot, project.id))).toBe(true)
    expect(existsSync(join(projectDir, 'index.html'))).toBe(true)
    expect(existsSync(join(projectDir, 'assets'))).toBe(true)

    const raw = JSON.parse(readFileSync(getDesignProjectMetaPath(wsRoot, project.id), 'utf-8'))
    expect(raw.schemaVersion).toBe(DESIGN_PROJECT_SCHEMA_VERSION)
    expect(raw.id).toBe(project.id)
    expect(raw.name).toBe('My Prototype')
    expect(raw.kind).toBe('prototype')
    expect(raw.entryFile).toBe('index.html')

    const html = readFileSync(join(projectDir, 'index.html'), 'utf-8')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Design project ready')
    expect(html.length).toBeGreaterThan(200)
  })

  it('create accepts an explicit artifact kind', async () => {
    const project = await createDesignProject(wsRoot, { name: 'Pitch Deck', kind: 'deck' })
    expect(project.kind).toBe('deck')
  })

  it('copies template files and records template metadata when templateId is provided', async () => {
    const project = await createDesignProject(wsRoot, { name: 'From Template', templateId: 'deck-template' }, { resourcesRoot })
    const projectDir = getDesignProjectDir(wsRoot, project.id)

    expect(project.kind).toBe('deck')
    expect(project.entryFile).toBe('slides/index.html')
    expect(project.templateId).toBe('deck-template')
    expect(project.designSystemId).toBeNull()
    expect(readFileSync(join(projectDir, 'slides', 'index.html'), 'utf-8')).toContain('Template first slide')
    expect(readFileSync(join(projectDir, 'assets', 'theme.css'), 'utf-8')).toContain('rebeccapurple')
    expect(readFileSync(getDesignProjectMetaPath(wsRoot, project.id), 'utf-8')).toContain('"templateId": "deck-template"')
    expect(readFileSync(join(projectDir, project.entryFile), 'utf-8')).not.toContain('Design project ready')
  })

  it('copies selected design system DESIGN.md and omits it when none is selected', async () => {
    const withSystem = await createDesignProject(wsRoot, { name: 'With System', designSystemId: 'system-one' }, { resourcesRoot })
    const withoutSystem = await createDesignProject(wsRoot, { name: 'No System' }, { resourcesRoot })

    expect(withSystem.designSystemId).toBe('system-one')
    expect(readFileSync(join(getDesignProjectDir(wsRoot, withSystem.id), 'DESIGN.md'), 'utf-8')).toBe('# System One\n\nUse sharp layouts.')
    expect(withoutSystem.designSystemId).toBeNull()
    expect(existsSync(join(getDesignProjectDir(wsRoot, withoutSystem.id), 'DESIGN.md'))).toBe(false)
  })

  it('rejects unknown template and design-system ids without leaving partial project directories', async () => {
    await expect(createDesignProject(wsRoot, { name: 'Bad Template', templateId: 'missing-template' }, { resourcesRoot })).rejects.toThrow('Unknown design template id')
    await expect(createDesignProject(wsRoot, { name: 'Bad System', designSystemId: 'missing-system' }, { resourcesRoot })).rejects.toThrow('Unknown design system id')
    await expect(createDesignProject(wsRoot, { name: 'Traversal', templateId: '../escape' }, { resourcesRoot })).rejects.toThrow('Invalid design template id')
    await expect(createDesignProject(wsRoot, { name: 'Empty Template', templateId: '' }, { resourcesRoot })).rejects.toThrow('Invalid design template id')
    await expect(createDesignProject(wsRoot, { name: 'Whitespace Template', templateId: '   ' }, { resourcesRoot })).rejects.toThrow('Invalid design template id')
    await expect(createDesignProject(wsRoot, { name: 'Empty System', designSystemId: '' }, { resourcesRoot })).rejects.toThrow('Invalid design system id')
    await expect(createDesignProject(wsRoot, { name: 'Whitespace System', designSystemId: '   ' }, { resourcesRoot })).rejects.toThrow('Invalid design system id')

    expect(existsSync(getWorkspaceDesignDir(wsRoot))).toBe(false)
  })

  it('load returns the created project, get missing returns null, and list returns metas sorted by updatedAt desc', async () => {
    const a = await createDesignProject(wsRoot, { name: 'A' })
    await Bun.sleep(2)
    const b = await createDesignProject(wsRoot, { name: 'B' })
    await Bun.write(join(getWorkspaceDesignDir(wsRoot), 'junk.txt'), 'not a project')
    await Bun.write(join(getWorkspaceDesignDir(wsRoot), 'broken', 'project.json'), '{oops')

    expect(loadDesignProject(wsRoot, a.id)).toEqual(a)
    expect(loadDesignProject(wsRoot, 'missing-id')).toBeNull()
    const metas = listDesignProjects(wsRoot)
    expect(metas.map(m => m.id)).toEqual([b.id, a.id])
    expect(metas[0]).toEqual({
      id: b.id,
      name: 'B',
      kind: 'prototype',
      sessionId: null,
      designSystemId: null,
      templateId: null,
      entryFile: 'index.html',
      thumbnailPath: null,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      version: 1,
    })
  })

  it('update applies metadata, bumps version and updatedAt, preserving createdAt', async () => {
    const project = await createDesignProject(wsRoot, { name: 'Before' })
    await Bun.sleep(2)

    const updated = await updateDesignProject(wsRoot, project.id, {
      name: 'After',
      sessionId: 'sess-1',
      designSystemId: 'system-1',
      templateId: 'template-1',
      thumbnailPath: 'thumb.png',
    })
    expect(updated.name).toBe('After')
    expect(updated.sessionId).toBe('sess-1')
    expect(updated.designSystemId).toBe('system-1')
    expect(updated.templateId).toBe('template-1')
    expect(updated.thumbnailPath).toBe('thumb.png')
    expect(updated.version).toBe(2)
    expect(updated.updatedAt).toBeGreaterThan(project.updatedAt)
    expect(updated.createdAt).toBe(project.createdAt)
    expect(loadDesignProject(wsRoot, project.id)).toEqual(updated)

    const cleared = await updateDesignProject(wsRoot, project.id, {
      sessionId: null,
      designSystemId: null,
      templateId: null,
      thumbnailPath: null,
    })
    expect(cleared.sessionId).toBeNull()
    expect(cleared.designSystemId).toBeNull()
    expect(cleared.templateId).toBeNull()
    expect(cleared.thumbnailPath).toBeNull()
    expect(cleared.version).toBe(3)
  })

  it('update rejects blank template and design-system ids without persisting them', async () => {
    const project = await createDesignProject(wsRoot, { name: 'Before' })

    await expect(updateDesignProject(wsRoot, project.id, { templateId: '' })).rejects.toThrow('Invalid design template id')
    await expect(updateDesignProject(wsRoot, project.id, { templateId: '   ' })).rejects.toThrow('Invalid design template id')
    await expect(updateDesignProject(wsRoot, project.id, { designSystemId: '' })).rejects.toThrow('Invalid design system id')
    await expect(updateDesignProject(wsRoot, project.id, { designSystemId: '   ' })).rejects.toThrow('Invalid design system id')

    expect(loadDesignProject(wsRoot, project.id)).toEqual(project)
  })

  it('update rejects a missing project without partial files', async () => {
    await expect(updateDesignProject(wsRoot, 'missing-id', { name: 'Nope' })).rejects.toThrow()
    expect(existsSync(getDesignProjectDir(wsRoot, 'missing-id'))).toBe(false)
  })

  it('delete recursively removes the whole project directory without touching siblings', async () => {
    const a = await createDesignProject(wsRoot, { name: 'A' })
    const b = await createDesignProject(wsRoot, { name: 'B' })
    await Bun.write(join(getDesignProjectDir(wsRoot, a.id), 'assets', 'marker.txt'), 'keep')

    expect(await deleteDesignProject(wsRoot, b.id)).toBe(true)
    expect(existsSync(getDesignProjectDir(wsRoot, b.id))).toBe(false)
    expect(readFileSync(join(getDesignProjectDir(wsRoot, a.id), 'assets', 'marker.txt'), 'utf-8')).toBe('keep')
    expect(await deleteDesignProject(wsRoot, b.id)).toBe(false)
  })
})

describe('design project storage atomicity and serialization', () => {
  it('a failed write leaves the previous project intact and no .tmp behind', async () => {
    const project = await createDesignProject(wsRoot, { name: 'Stable' })
    await expect(updateDesignProject(wsRoot, project.id, { name: 1n as unknown as string })).rejects.toThrow()

    const onDisk = JSON.parse(readFileSync(getDesignProjectMetaPath(wsRoot, project.id), 'utf-8'))
    expect(onDisk.version).toBe(1)
    expect(onDisk.name).toBe('Stable')
    expect(readdirSync(getDesignProjectDir(wsRoot, project.id)).filter(f => f.endsWith('.tmp'))).toEqual([])
  })

  it('serializes concurrent updates per project so every version lands', async () => {
    const project = await createDesignProject(wsRoot, { name: 'Contended' })
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => updateDesignProject(wsRoot, project.id, { name: `w${i}` })),
    )

    const versions = results.map(r => r.version).sort((a, b) => a - b)
    expect(versions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    const onDisk = loadDesignProject(wsRoot, project.id)!
    expect(onDisk.version).toBe(11)
    expect(onDisk.name).toBe(results.find(r => r.version === 11)!.name)
    expect(readdirSync(getDesignProjectDir(wsRoot, project.id)).filter(f => f.endsWith('.tmp'))).toEqual([])
  })
})
