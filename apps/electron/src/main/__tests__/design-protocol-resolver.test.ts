import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveDesignRequest, type WorkspaceRootResolver } from '../design-protocol-resolver'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeRoot(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `design-protocol-${name}-`))
  tempDirs.push(dir)
  return realpathSync(dir)
}

async function createProject(workspaceRoot: string, projectId: string, files: Record<string, string> = {}): Promise<string> {
  const projectDir = join(workspaceRoot, 'design', projectId)
  await mkdir(projectDir, { recursive: true })
  for (const [relPath, content] of Object.entries(files)) {
    const filePath = join(projectDir, relPath)
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
  }
  return projectDir
}

function resolver(workspaces: Record<string, string>): WorkspaceRootResolver {
  return (workspaceId) => workspaces[workspaceId] ?? null
}

function designUrl(workspaceId: string, projectId: string, relPath: string): string {
  const path = relPath.split('/').map(encodeURIComponent).join('/')
  return `design://project/${encodeURIComponent(workspaceId)}/${encodeURIComponent(projectId)}/${path}`
}

describe('resolveDesignRequest', () => {
  it('resolves an existing project file with extension content type', async () => {
    const workspaceRoot = makeRoot('happy')
    await createProject(workspaceRoot, 'project-a', { 'assets/style.css': 'body { color: red; }' })

    const result = await resolveDesignRequest(resolver({ ws: workspaceRoot }), designUrl('ws', 'project-a', 'assets/style.css'))

    expect(result.status).toBe(200)
    expect(result.filePath).toBe(join(workspaceRoot, 'design', 'project-a', 'assets', 'style.css'))
    expect(result.contentType).toBe('text/css')
  })

  it('rejects plain ../ traversal outside the project dir', async () => {
    const workspaceRoot = makeRoot('plain-traversal')
    await createProject(workspaceRoot, 'project-a', { 'index.html': '<h1>A</h1>' })
    await createProject(workspaceRoot, 'other', { 'secret.txt': 'secret' })

    const result = await resolveDesignRequest(
      resolver({ ws: workspaceRoot }),
      'design://project/ws/project-a/../other/secret.txt',
    )

    expect(result.status).not.toBe(200)
    expect(result.filePath).toBeUndefined()
  })

  it('rejects encoded and double-encoded traversal', async () => {
    const workspaceRoot = makeRoot('encoded-traversal')
    await createProject(workspaceRoot, 'project-a', { 'index.html': '<h1>A</h1>' })
    await createProject(workspaceRoot, 'other', { 'secret.txt': 'secret' })

    const encoded = await resolveDesignRequest(
      resolver({ ws: workspaceRoot }),
      'design://project/ws/project-a/%2e%2e%2fother%2fsecret.txt',
    )
    const doubleEncoded = await resolveDesignRequest(
      resolver({ ws: workspaceRoot }),
      'design://project/ws/project-a/%252e%252e%252fother%252fsecret.txt',
    )

    expect(encoded.status).not.toBe(200)
    expect(encoded.filePath).toBeUndefined()
    expect(doubleEncoded.status).not.toBe(200)
    expect(doubleEncoded.filePath).toBeUndefined()
  })

  it('does not serve symlinks that resolve outside the project dir', async () => {
    const workspaceRoot = makeRoot('symlink')
    const projectDir = await createProject(workspaceRoot, 'project-a', { 'index.html': '<h1>A</h1>' })
    const outsideFile = join(workspaceRoot, 'outside-secret.txt')
    writeFileSync(outsideFile, 'secret', 'utf-8')
    symlinkSync(outsideFile, join(projectDir, 'escape.txt'))

    const result = await resolveDesignRequest(resolver({ ws: workspaceRoot }), designUrl('ws', 'project-a', 'escape.txt'))

    expect(result.status).not.toBe(200)
    expect(result.filePath).toBeUndefined()
  })

  it('does not serve cross-project or cross-workspace files', async () => {
    const workspaceRoot = makeRoot('workspace-a')
    const otherWorkspaceRoot = makeRoot('workspace-b')
    await createProject(workspaceRoot, 'project-a', { 'index.html': '<h1>A</h1>' })
    await createProject(workspaceRoot, 'project-b', { 'secret.txt': 'project b secret' })
    await createProject(otherWorkspaceRoot, 'project-a', { 'secret.txt': 'workspace b secret' })

    const crossProject = await resolveDesignRequest(
      resolver({ ws: workspaceRoot, otherWs: otherWorkspaceRoot }),
      'design://project/ws/project-a/../project-b/secret.txt',
    )
    const crossWorkspace = await resolveDesignRequest(
      resolver({ ws: workspaceRoot, otherWs: otherWorkspaceRoot }),
      designUrl('ws', 'project-a', 'secret.txt'),
    )
    const mismatchedWorkspace = await resolveDesignRequest(
      resolver({ ws: workspaceRoot, otherWs: otherWorkspaceRoot }),
      designUrl('otherWs', 'project-a', 'index.html'),
    )

    expect(crossProject.status).not.toBe(200)
    expect(crossProject.filePath).toBeUndefined()
    expect(crossWorkspace.status).toBe(404)
    expect(crossWorkspace.filePath).toBeUndefined()
    expect(mismatchedWorkspace.status).toBe(404)
    expect(mismatchedWorkspace.filePath).toBeUndefined()
  })

  it('rejects absolute path injection in the relPath', async () => {
    const workspaceRoot = makeRoot('absolute')
    await createProject(workspaceRoot, 'project-a', { 'index.html': '<h1>A</h1>' })

    const posixAbsolute = await resolveDesignRequest(
      resolver({ ws: workspaceRoot }),
      'design://project/ws/project-a/%2Fetc%2Fhosts',
    )
    const windowsAbsolute = await resolveDesignRequest(
      resolver({ ws: workspaceRoot }),
      'design://project/ws/project-a/C%3A%5CWindows%5CSystem32%5Cdrivers%5Cetc%5Chosts',
    )

    expect(posixAbsolute.status).not.toBe(200)
    expect(posixAbsolute.filePath).toBeUndefined()
    expect(windowsAbsolute.status).not.toBe(200)
    expect(windowsAbsolute.filePath).toBeUndefined()
  })

  it('returns 404 for missing files', async () => {
    const workspaceRoot = makeRoot('missing')
    await createProject(workspaceRoot, 'project-a', { 'index.html': '<h1>A</h1>' })

    const result = await resolveDesignRequest(resolver({ ws: workspaceRoot }), designUrl('ws', 'project-a', 'missing.png'))

    expect(result.status).toBe(404)
    expect(result.filePath).toBeUndefined()
  })

  it('adds restrictive CSP for HTML responses', async () => {
    const workspaceRoot = makeRoot('csp')
    await createProject(workspaceRoot, 'project-a', { 'index.html': '<h1>A</h1>' })

    const result = await resolveDesignRequest(resolver({ ws: workspaceRoot }), designUrl('ws', 'project-a', 'index.html'))

    const csp = result.headers?.['Content-Security-Policy']
    expect(result.status).toBe(200)
    expect(result.contentType).toBe('text/html')
    expect(csp).toBeTruthy()
    expect(csp).toContain("default-src 'self' 'unsafe-inline' data: blob:")
    expect(csp).not.toContain('*')
    expect(csp).not.toContain('https:')
    expect(csp).not.toContain('http:')
  })

  it('serves unknown extensions as application/octet-stream', async () => {
    const workspaceRoot = makeRoot('octet')
    await createProject(workspaceRoot, 'project-a', { 'payload.xyz': '<script>alert(1)</script>' })

    const result = await resolveDesignRequest(resolver({ ws: workspaceRoot }), designUrl('ws', 'project-a', 'payload.xyz'))

    expect(result.status).toBe(200)
    expect(result.contentType).toBe('application/octet-stream')
  })
})
