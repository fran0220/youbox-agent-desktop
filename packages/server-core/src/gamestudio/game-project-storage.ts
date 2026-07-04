/**
 * Game Studio project storage — workspace-scoped project directories.
 *
 * Layout:
 *   <workspace>/gamestudio/{projectId}/project.json
 *   <workspace>/gamestudio/{projectId}/index.html
 *   <workspace>/gamestudio/{projectId}/src/main.js
 *   <workspace>/gamestudio/{projectId}/vendor/{three.module.js,rapier.es.js}
 *
 * Metadata writes are atomic (tmp + rename) and serialized per project so
 * concurrent RPC mutations cannot interleave on the same project.json file.
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { copyFile, mkdir, rename, rm, unlink, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { basename, dirname, join } from 'path'
import { promisify } from 'util'
import type {
  GameProject,
  GameProjectCheckpointResult,
  GameProjectCreateInput,
  GameProjectMeta,
  GameProjectUpdateInput,
} from '@craft-agent/shared/protocol'

export const GAME_PROJECT_SCHEMA_VERSION = 1

export interface StoredGameProject extends GameProject {
  schemaVersion: number
}

export interface GameProjectStorageOptions {
  /** Directory containing gamestudio/vendor/*.js. */
  resourcesRoot: string
}

const DOC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const execFileAsync = promisify(execFile)

function assertValidProjectId(projectId: string): void {
  if (!projectId || typeof projectId !== 'string' || basename(projectId) !== projectId || !DOC_ID_PATTERN.test(projectId)) {
    throw new Error(`Invalid game project id: ${JSON.stringify(projectId)}`)
  }
}

export function getWorkspaceGameStudioDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'gamestudio')
}

export function getGameProjectDir(workspaceRootPath: string, projectId: string): string {
  assertValidProjectId(projectId)
  return join(getWorkspaceGameStudioDir(workspaceRootPath), projectId)
}

export function getGameProjectMetaPath(workspaceRootPath: string, projectId: string): string {
  return join(getGameProjectDir(workspaceRootPath, projectId), 'project.json')
}

class GameProjectWriteQueue {
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

const writeQueue = new GameProjectWriteQueue()

async function writeProjectFileAtomic(filePath: string, project: StoredGameProject): Promise<void> {
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

function parseStoredProject(raw: string): StoredGameProject | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredGameProject>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null
    return {
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : GAME_PROJECT_SCHEMA_VERSION,
      id: parsed.id,
      name: typeof parsed.name === 'string' ? parsed.name : 'Untitled Game',
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
      thumbnailPath: typeof parsed.thumbnailPath === 'string' ? parsed.thumbnailPath : null,
      lastPlayableCommit: typeof parsed.lastPlayableCommit === 'string' ? parsed.lastPlayableCommit : null,
      lastGeneratedCommit: typeof parsed.lastGeneratedCommit === 'string' ? parsed.lastGeneratedCommit : null,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      version: typeof parsed.version === 'number' ? parsed.version : 1,
    }
  } catch {
    return null
  }
}

function toProject(stored: StoredGameProject): GameProject {
  const { schemaVersion: _schemaVersion, ...project } = stored
  return project
}

function toMeta(project: GameProject): GameProjectMeta {
  return {
    id: project.id,
    name: project.name,
    sessionId: project.sessionId,
    thumbnailPath: project.thumbnailPath,
    lastPlayableCommit: project.lastPlayableCommit,
    lastGeneratedCommit: project.lastGeneratedCommit,
    lastError: project.lastError,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    version: project.version,
  }
}

export function loadGameProject(workspaceRootPath: string, projectId: string): GameProject | null {
  const filePath = getGameProjectMetaPath(workspaceRootPath, projectId)
  if (!existsSync(filePath)) return null
  const stored = parseStoredProject(readFileSync(filePath, 'utf-8'))
  return stored ? toProject(stored) : null
}

export function listGameProjects(workspaceRootPath: string): GameProjectMeta[] {
  const dir = getWorkspaceGameStudioDir(workspaceRootPath)
  if (!existsSync(dir)) return []

  const metas: GameProjectMeta[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const stored = parseStoredProject(readFileSync(join(dir, entry.name, 'project.json'), 'utf-8'))
      if (stored) metas.push(toMeta(toProject(stored)))
    } catch {
      // unreadable/corrupt project — skip
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt)
}

function getVendorSourcePath(resourcesRoot: string, fileName: string): string {
  const filePath = join(resourcesRoot, 'gamestudio', 'vendor', fileName)
  if (!existsSync(filePath)) {
    throw new Error(`Missing Game Studio vendor file: ${filePath}`)
  }
  return filePath
}

async function scaffoldProject(projectDir: string, options: GameProjectStorageOptions): Promise<void> {
  await mkdir(join(projectDir, 'src'), { recursive: true })
  await mkdir(join(projectDir, 'vendor'), { recursive: true })
  await mkdir(join(projectDir, '.agents'), { recursive: true })
  await writeFile(join(projectDir, 'index.html'), GAME_PROJECT_INDEX_HTML, 'utf-8')
  await writeFile(join(projectDir, 'src', 'main.js'), GAME_PROJECT_MAIN_JS, 'utf-8')
  await writeFile(join(projectDir, 'gameblocks_usage.md'), GAMEBLOCKS_USAGE_MD, 'utf-8')
  await writeFile(join(projectDir, '.agents', 'AGENTS.md'), GAME_PROJECT_AGENTS_MD, 'utf-8')
  await copyFile(getVendorSourcePath(options.resourcesRoot, 'three.module.js'), join(projectDir, 'vendor', 'three.module.js'))
  await copyFile(getVendorSourcePath(options.resourcesRoot, 'rapier.es.js'), join(projectDir, 'vendor', 'rapier.es.js'))
}

export async function createGameProject(
  workspaceRootPath: string,
  input: GameProjectCreateInput = {},
  options: GameProjectStorageOptions,
): Promise<GameProject> {
  const projectId = randomUUID()
  const now = Date.now()
  const project: GameProject = {
    id: projectId,
    name: input.name ?? 'Untitled Game',
    sessionId: null,
    thumbnailPath: null,
    lastPlayableCommit: null,
    lastGeneratedCommit: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }

  await writeQueue.enqueue(projectQueueKey(workspaceRootPath, projectId), async () => {
    const projectDir = getGameProjectDir(workspaceRootPath, projectId)
    await scaffoldProject(projectDir, options)
    await initializeProjectGit(projectDir)
    await writeProjectFileAtomic(getGameProjectMetaPath(workspaceRootPath, projectId), {
      schemaVersion: GAME_PROJECT_SCHEMA_VERSION,
      ...project,
    })
    const commit = await createGitCheckpoint(projectDir, 'Initial playable scaffold')
    if (commit) {
      project.lastPlayableCommit = commit
      project.lastGeneratedCommit = commit
      await writeProjectFileAtomic(getGameProjectMetaPath(workspaceRootPath, projectId), {
        schemaVersion: GAME_PROJECT_SCHEMA_VERSION,
        ...project,
      })
    }
  })
  return project
}

export async function updateGameProject(
  workspaceRootPath: string,
  projectId: string,
  patch: GameProjectUpdateInput,
): Promise<GameProject> {
  const filePath = getGameProjectMetaPath(workspaceRootPath, projectId)
  return writeQueue.enqueue(projectQueueKey(workspaceRootPath, projectId), async () => {
    const current = loadGameProject(workspaceRootPath, projectId)
    if (!current) throw new Error(`Game project not found: ${projectId}`)

    const next: GameProject = {
      ...current,
      name: patch.name ?? current.name,
      sessionId: patch.sessionId !== undefined ? patch.sessionId : current.sessionId,
      thumbnailPath: patch.thumbnailPath !== undefined ? patch.thumbnailPath : current.thumbnailPath,
      lastPlayableCommit: patch.lastPlayableCommit !== undefined ? patch.lastPlayableCommit : current.lastPlayableCommit,
      lastGeneratedCommit: patch.lastGeneratedCommit !== undefined ? patch.lastGeneratedCommit : current.lastGeneratedCommit,
      lastError: patch.lastError !== undefined ? patch.lastError : current.lastError,
      updatedAt: Date.now(),
      version: current.version + 1,
    }
    await writeProjectFileAtomic(filePath, { schemaVersion: GAME_PROJECT_SCHEMA_VERSION, ...next })
    return next
  })
}

export async function checkpointGameProject(
  workspaceRootPath: string,
  projectId: string,
  playable = false,
): Promise<GameProjectCheckpointResult> {
  return writeQueue.enqueue(projectQueueKey(workspaceRootPath, projectId), async () => {
    const current = loadGameProject(workspaceRootPath, projectId)
    if (!current) throw new Error(`Game project not found: ${projectId}`)
    const projectDir = getGameProjectDir(workspaceRootPath, projectId)
    await initializeProjectGit(projectDir)
    const commit = await createGitCheckpoint(projectDir, playable ? 'Playable Game Studio checkpoint' : 'Generated Game Studio checkpoint')
    if (!commit) return { commit: null }

    const next: GameProject = {
      ...current,
      lastGeneratedCommit: commit,
      lastPlayableCommit: playable ? commit : current.lastPlayableCommit,
      updatedAt: Date.now(),
      version: current.version + 1,
    }
    await writeProjectFileAtomic(getGameProjectMetaPath(workspaceRootPath, projectId), {
      schemaVersion: GAME_PROJECT_SCHEMA_VERSION,
      ...next,
    })
    return { commit }
  })
}

export async function restoreGameProject(workspaceRootPath: string, projectId: string): Promise<GameProject | null> {
  return writeQueue.enqueue(projectQueueKey(workspaceRootPath, projectId), async () => {
    const current = loadGameProject(workspaceRootPath, projectId)
    if (!current?.lastPlayableCommit) return current
    const projectDir = getGameProjectDir(workspaceRootPath, projectId)
    await git(projectDir, ['checkout', current.lastPlayableCommit, '--', '.'])
    const commit = await createGitCheckpoint(projectDir, 'Restore last playable Game Studio checkpoint')
    const next: GameProject = {
      ...current,
      lastGeneratedCommit: commit ?? current.lastGeneratedCommit,
      lastError: null,
      updatedAt: Date.now(),
      version: current.version + 1,
    }
    await writeProjectFileAtomic(getGameProjectMetaPath(workspaceRootPath, projectId), {
      schemaVersion: GAME_PROJECT_SCHEMA_VERSION,
      ...next,
    })
    return next
  })
}

export async function deleteGameProject(workspaceRootPath: string, projectId: string): Promise<boolean> {
  const projectDir = getGameProjectDir(workspaceRootPath, projectId)
  return writeQueue.enqueue(projectQueueKey(workspaceRootPath, projectId), async () => {
    if (!existsSync(projectDir)) return false
    await rm(projectDir, { recursive: true, force: true })
    return true
  })
}

function projectQueueKey(workspaceRootPath: string, projectId: string): string {
  return `${workspaceRootPath}::${projectId}`
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return String(stdout).trim()
}

async function initializeProjectGit(projectDir: string): Promise<void> {
  if (existsSync(join(projectDir, '.git'))) return
  await git(projectDir, ['init'])
  await git(projectDir, ['config', 'user.email', 'gamestudio@local'])
  await git(projectDir, ['config', 'user.name', 'Game Studio'])
  await writeFile(join(projectDir, '.gitignore'), 'node_modules/\n.DS_Store\n*.log\n', 'utf-8')
}

async function createGitCheckpoint(projectDir: string, message: string): Promise<string | null> {
  await git(projectDir, ['add', '.'])
  const status = await git(projectDir, ['status', '--porcelain'])
  if (!status) {
    try {
      return await git(projectDir, ['rev-parse', 'HEAD'])
    } catch {
      return null
    }
  }
  await git(projectDir, ['commit', '-m', message])
  return git(projectDir, ['rev-parse', 'HEAD'])
}

const GAME_PROJECT_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Game Studio Project</title>
    <script type="importmap">{"imports":{"three": "./vendor/three.module.js"}}</script>
    <style>
      html, body, canvas {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        display: block;
        background: #0f172a;
      }
    </style>
  </head>
  <body>
    <script type="module" src="./src/main.js"></script>
  </body>
</html>
`

const GAME_PROJECT_MAIN_JS = `import * as THREE from 'three'

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0f172a)

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.set(2, 2, 4)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const geometry = new THREE.BoxGeometry(1, 1, 1)
const material = new THREE.MeshStandardMaterial({ color: 0x60a5fa, roughness: 0.45, metalness: 0.15 })
const cube = new THREE.Mesh(geometry, material)
scene.add(cube)

const keyLight = new THREE.DirectionalLight(0xffffff, 2)
keyLight.position.set(3, 4, 5)
scene.add(keyLight)
scene.add(new THREE.AmbientLight(0x93c5fd, 0.6))

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', resize)

function animate() {
  cube.rotation.x += 0.01
  cube.rotation.y += 0.015
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()
`

const GAMEBLOCKS_USAGE_MD = `# GameBlocks usage

This Game Studio project is a browser-only game. Keep the entry point at \`index.html\` and \`src/main.js\` unless the user asks for a larger structure.

- Use vendored modules from \`./vendor/\`; do not import from external CDNs.
- Prefer Three.js for rendering and Rapier for physics when needed.
- Keep runtime errors visible in the preview console and fix them before marking the game playable.
- After a playable change, ask Game Studio to create a playable checkpoint from the toolbar.
`

const GAME_PROJECT_AGENTS_MD = `# Game Studio project

You are editing a generated browser game. The preview runs from this directory through a local static server.

Rules:
- Do not use external CDNs or network dependencies. Use files in vendor/.
- Keep index.html loadable as an ES-module browser app.
- Keep controls discoverable in the UI and preserve fullscreen/pointer-lock behavior when relevant.
- When fixing runtime errors, use the console event details from the user prompt as the source of truth.
- Prefer small playable iterations over large rewrites.
`
