/**
 * Design project storage, workspace-scoped project directories.
 *
 * Layout:
 *   <workspace>/design/{projectId}/project.json
 *   <workspace>/design/{projectId}/index.html
 *   <workspace>/design/{projectId}/assets/
 *
 * Metadata writes are atomic (tmp + rename) and serialized per project so
 * concurrent RPC mutations cannot interleave on the same project.json file.
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { mkdir, rename, rm, unlink, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { basename, dirname, join } from 'path'
import type {
  DesignArtifactKind,
  DesignProject,
  DesignProjectCreateInput,
  DesignProjectMeta,
  DesignProjectUpdateInput,
} from '@craft-agent/shared/protocol'

export const DESIGN_PROJECT_SCHEMA_VERSION = 1

export interface StoredDesignProject extends DesignProject {
  schemaVersion: number
}

const DOC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const DESIGN_ARTIFACT_KINDS = new Set<DesignArtifactKind>(['prototype', 'deck', 'doc', 'image'])

function assertValidProjectId(projectId: string): void {
  if (!projectId || typeof projectId !== 'string' || basename(projectId) !== projectId || !DOC_ID_PATTERN.test(projectId)) {
    throw new Error(`Invalid design project id: ${JSON.stringify(projectId)}`)
  }
}

function normalizeKind(kind: unknown): DesignArtifactKind {
  return DESIGN_ARTIFACT_KINDS.has(kind as DesignArtifactKind) ? kind as DesignArtifactKind : 'prototype'
}

export function getWorkspaceDesignDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'design')
}

export function getDesignProjectDir(workspaceRootPath: string, projectId: string): string {
  assertValidProjectId(projectId)
  return join(getWorkspaceDesignDir(workspaceRootPath), projectId)
}

export function getDesignProjectMetaPath(workspaceRootPath: string, projectId: string): string {
  return join(getDesignProjectDir(workspaceRootPath, projectId), 'project.json')
}

class DesignProjectWriteQueue {
  private tails = new Map<string, Promise<void>>()

  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    const run = prev.then(task, task)
    const tail = run.then(() => undefined, () => undefined)
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return run
  }
}

const writeQueue = new DesignProjectWriteQueue()

async function writeProjectFileAtomic(filePath: string, project: StoredDesignProject): Promise<void> {
  const json = JSON.stringify(project, null, 2)
  await mkdir(dirname(filePath), { recursive: true })

  const tmpFile = filePath + '.tmp'
  try {
    await writeFile(tmpFile, json, 'utf-8')
    try { await unlink(filePath) } catch { /* ignore if doesn't exist */ }
    await rename(tmpFile, filePath)
  } catch (error) {
    try { await unlink(tmpFile) } catch { /* best-effort cleanup */ }
    throw error
  }
}

function parseStoredProject(raw: string): StoredDesignProject | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDesignProject>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null
    return {
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : DESIGN_PROJECT_SCHEMA_VERSION,
      id: parsed.id,
      name: typeof parsed.name === 'string' ? parsed.name : 'Untitled Design',
      kind: normalizeKind(parsed.kind),
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
      designSystemId: typeof parsed.designSystemId === 'string' ? parsed.designSystemId : null,
      templateId: typeof parsed.templateId === 'string' ? parsed.templateId : null,
      entryFile: typeof parsed.entryFile === 'string' ? parsed.entryFile : 'index.html',
      thumbnailPath: typeof parsed.thumbnailPath === 'string' ? parsed.thumbnailPath : null,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      version: typeof parsed.version === 'number' ? parsed.version : 1,
    }
  } catch {
    return null
  }
}

function toProject(stored: StoredDesignProject): DesignProject {
  const { schemaVersion: _schemaVersion, ...project } = stored
  return project
}

function toMeta(project: DesignProject): DesignProjectMeta {
  return {
    id: project.id,
    name: project.name,
    kind: project.kind,
    sessionId: project.sessionId,
    designSystemId: project.designSystemId,
    templateId: project.templateId,
    entryFile: project.entryFile,
    thumbnailPath: project.thumbnailPath,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    version: project.version,
  }
}

export function loadDesignProject(workspaceRootPath: string, projectId: string): DesignProject | null {
  const filePath = getDesignProjectMetaPath(workspaceRootPath, projectId)
  if (!existsSync(filePath)) return null
  const stored = parseStoredProject(readFileSync(filePath, 'utf-8'))
  return stored ? toProject(stored) : null
}

export function listDesignProjects(workspaceRootPath: string): DesignProjectMeta[] {
  const dir = getWorkspaceDesignDir(workspaceRootPath)
  if (!existsSync(dir)) return []

  const metas: DesignProjectMeta[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const stored = parseStoredProject(readFileSync(join(dir, entry.name, 'project.json'), 'utf-8'))
      if (stored) metas.push(toMeta(toProject(stored)))
    } catch {
      // unreadable/corrupt project, skip
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt)
}

async function scaffoldProject(projectDir: string): Promise<void> {
  await mkdir(join(projectDir, 'assets'), { recursive: true })
  await writeFile(join(projectDir, 'index.html'), DESIGN_PROJECT_INDEX_HTML, 'utf-8')
}

export async function createDesignProject(
  workspaceRootPath: string,
  input: DesignProjectCreateInput = {},
): Promise<DesignProject> {
  const projectId = randomUUID()
  const now = Date.now()
  const project: DesignProject = {
    id: projectId,
    name: input.name ?? 'Untitled Design',
    kind: normalizeKind(input.kind),
    sessionId: null,
    designSystemId: null,
    templateId: null,
    entryFile: 'index.html',
    thumbnailPath: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }

  await writeQueue.enqueue(projectQueueKey(workspaceRootPath, projectId), async () => {
    const projectDir = getDesignProjectDir(workspaceRootPath, projectId)
    await scaffoldProject(projectDir)
    await writeProjectFileAtomic(getDesignProjectMetaPath(workspaceRootPath, projectId), {
      schemaVersion: DESIGN_PROJECT_SCHEMA_VERSION,
      ...project,
    })
  })
  return project
}

export async function updateDesignProject(
  workspaceRootPath: string,
  projectId: string,
  patch: DesignProjectUpdateInput,
): Promise<DesignProject> {
  const filePath = getDesignProjectMetaPath(workspaceRootPath, projectId)
  return writeQueue.enqueue(projectQueueKey(workspaceRootPath, projectId), async () => {
    const current = loadDesignProject(workspaceRootPath, projectId)
    if (!current) throw new Error(`Design project not found: ${projectId}`)

    const next: DesignProject = {
      ...current,
      name: patch.name ?? current.name,
      sessionId: patch.sessionId !== undefined ? patch.sessionId : current.sessionId,
      designSystemId: patch.designSystemId !== undefined ? patch.designSystemId : current.designSystemId,
      templateId: patch.templateId !== undefined ? patch.templateId : current.templateId,
      thumbnailPath: patch.thumbnailPath !== undefined ? patch.thumbnailPath : current.thumbnailPath,
      updatedAt: Date.now(),
      version: current.version + 1,
    }
    await writeProjectFileAtomic(filePath, { schemaVersion: DESIGN_PROJECT_SCHEMA_VERSION, ...next })
    return next
  })
}

export async function deleteDesignProject(workspaceRootPath: string, projectId: string): Promise<boolean> {
  const projectDir = getDesignProjectDir(workspaceRootPath, projectId)
  return writeQueue.enqueue(projectQueueKey(workspaceRootPath, projectId), async () => {
    if (!existsSync(projectDir)) return false
    await rm(projectDir, { recursive: true, force: true })
    return true
  })
}

function projectQueueKey(workspaceRootPath: string, projectId: string): string {
  return `${workspaceRootPath}::${projectId}`
}

const DESIGN_PROJECT_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Design Project</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #0f172a;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(99, 102, 241, 0.18), transparent 32rem),
          linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
      }

      main {
        width: min(42rem, calc(100vw - 3rem));
        padding: 3rem;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 1.5rem;
        background: rgba(255, 255, 255, 0.86);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
        text-align: center;
      }

      .eyebrow {
        margin: 0 0 0.75rem;
        color: #4f46e5;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(2.25rem, 7vw, 4.25rem);
        line-height: 0.95;
        letter-spacing: -0.06em;
      }

      p {
        max-width: 32rem;
        margin: 1.25rem auto 0;
        color: #475569;
        font-size: 1.05rem;
        line-height: 1.7;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">OriginAI Design</p>
      <h1>Design project ready</h1>
      <p>Ask the agent to shape this artifact, or edit this file directly. Keep assets self-hosted in the assets folder.</p>
    </main>
  </body>
</html>
`
