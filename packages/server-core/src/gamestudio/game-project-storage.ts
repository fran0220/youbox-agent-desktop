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

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { copyFile, cp, mkdir, rename, rm, unlink, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { basename, dirname, isAbsolute, join } from 'path'
import type {
  GameProject,
  GameProjectCreateInput,
  GameProjectMeta,
  GameProjectUpdateInput,
} from '@craft-agent/shared/protocol'

export const GAME_PROJECT_SCHEMA_VERSION = 1
const execFileAsync = promisify(execFile)

export interface StoredGameProject extends GameProject {
  schemaVersion: number
}

export interface GameProjectStorageOptions {
  /** Directory containing gamestudio/vendor/*.js. */
  resourcesRoot: string
}

const DOC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

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
      autoFix: typeof parsed.autoFix === 'boolean' ? parsed.autoFix : false,
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
    autoFix: project.autoFix,
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

function getTemplateSourcePath(resourcesRoot: string, templateId: string): string | null {
  if (!templateId || basename(templateId) !== templateId || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(templateId)) return null
  const templatePath = join(resourcesRoot, 'gamestudio', 'templates', templateId, 'files')
  return existsSync(templatePath) ? templatePath : null
}

async function scaffoldProject(projectDir: string, options: GameProjectStorageOptions, templateId?: string): Promise<void> {
  await mkdir(join(projectDir, 'src'), { recursive: true })
  await mkdir(join(projectDir, 'vendor'), { recursive: true })
  await mkdir(join(projectDir, '.agents', 'skills', 'gameblocks'), { recursive: true })
  await writeFile(join(projectDir, 'AGENTS.md'), GAME_PROJECT_AGENTS_MD, 'utf-8')
  await writeFile(join(projectDir, '.agents', 'skills', 'gameblocks', 'SKILL.md'), GAMEBLOCKS_SKILL_MD, 'utf-8')
  await writeFile(join(projectDir, 'index.html'), GAME_PROJECT_INDEX_HTML, 'utf-8')
  await writeFile(join(projectDir, 'src', 'main.js'), GAME_PROJECT_MAIN_JS, 'utf-8')
  await copyFile(getVendorSourcePath(options.resourcesRoot, 'three.module.js'), join(projectDir, 'vendor', 'three.module.js'))
  await copyFile(getVendorSourcePath(options.resourcesRoot, 'rapier.es.js'), join(projectDir, 'vendor', 'rapier.es.js'))
  if (templateId) {
    const templatePath = getTemplateSourcePath(options.resourcesRoot, templateId)
    if (!templatePath) throw new Error(`Missing Game Studio template: ${templateId}`)
    await cp(templatePath, projectDir, { recursive: true, force: true })
  }
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
    autoFix: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }

  await writeQueue.enqueue(projectQueueKey(workspaceRootPath, projectId), async () => {
    const projectDir = getGameProjectDir(workspaceRootPath, projectId)
    await scaffoldProject(projectDir, options, input.template)
    await writeProjectFileAtomic(getGameProjectMetaPath(workspaceRootPath, projectId), {
      schemaVersion: GAME_PROJECT_SCHEMA_VERSION,
      ...project,
    })
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
      autoFix: patch.autoFix !== undefined ? patch.autoFix : current.autoFix,
      updatedAt: Date.now(),
      version: current.version + 1,
    }
    await writeProjectFileAtomic(filePath, { schemaVersion: GAME_PROJECT_SCHEMA_VERSION, ...next })
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

export async function checkpointGameProject(workspaceRootPath: string, projectId: string): Promise<GameProject> {
  return writeQueue.enqueue(projectQueueKey(workspaceRootPath, projectId), async () => {
    const projectDir = getGameProjectDir(workspaceRootPath, projectId)
    const current = loadGameProject(workspaceRootPath, projectId)
    if (!current) throw new Error(`Game project not found: ${projectId}`)

    await runGit(projectDir, ['init'])
    await runGit(projectDir, ['add', '-A'])
    const hasChanges = await hasStagedGitChanges(projectDir)
    let commit = await getGitHead(projectDir)
    if (hasChanges || !commit) {
      await runGit(projectDir, [
        '-c', 'user.name=OriginAI Game Studio',
        '-c', 'user.email=gamestudio@originai.local',
        'commit', '-m', 'Game Studio checkpoint',
        '--allow-empty',
      ])
      commit = await getGitHead(projectDir)
    }
    if (!commit) throw new Error(`Failed to create game project checkpoint: ${projectId}`)

    return writeProjectMetadata(workspaceRootPath, projectId, {
      ...current,
      lastPlayableCommit: commit,
      updatedAt: Date.now(),
      version: current.version + 1,
    })
  })
}

export async function restoreGameProject(workspaceRootPath: string, projectId: string, commit?: string | null): Promise<GameProject> {
  return writeQueue.enqueue(projectQueueKey(workspaceRootPath, projectId), async () => {
    const current = loadGameProject(workspaceRootPath, projectId)
    if (!current) throw new Error(`Game project not found: ${projectId}`)
    const targetCommit = commit ?? current.lastPlayableCommit
    if (!targetCommit) throw new Error(`Game project has no playable checkpoint: ${projectId}`)

    const projectDir = getGameProjectDir(workspaceRootPath, projectId)
    await runGit(projectDir, ['reset', '--hard', targetCommit])
    await runGit(projectDir, ['clean', '-fd'])

    return writeProjectMetadata(workspaceRootPath, projectId, {
      ...current,
      lastPlayableCommit: targetCommit,
      updatedAt: Date.now(),
      version: current.version + 1,
    })
  })
}

async function writeProjectMetadata(workspaceRootPath: string, projectId: string, project: GameProject): Promise<GameProject> {
  await writeProjectFileAtomic(getGameProjectMetaPath(workspaceRootPath, projectId), {
    schemaVersion: GAME_PROJECT_SCHEMA_VERSION,
    ...project,
  })
  return project
}

async function runGit(projectDir: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: projectDir, maxBuffer: 1024 * 1024 })
}

async function getGitHead(projectDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectDir, maxBuffer: 1024 * 1024 })
    const commit = stdout.trim()
    return commit || null
  } catch {
    return null
  }
}

async function hasStagedGitChanges(projectDir: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['diff', '--cached', '--quiet'], { cwd: projectDir, maxBuffer: 1024 * 1024 })
    return false
  } catch {
    return true
  }
}

function projectQueueKey(workspaceRootPath: string, projectId: string): string {
  return `${workspaceRootPath}::${projectId}`
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

const GAME_PROJECT_AGENTS_MD = `# Game Studio Project

You are editing a browser-playable Game Studio project.

## Runtime

- The app preview serves this directory from localhost and loads \`index.html\`.
- Keep the project self-contained. Do not use CDNs, hotlinked assets, external script URLs, or external font hosts.
- Three.js is vendored at \`./vendor/three.module.js\` and available through the scaffold import map as \`three\`.
- Rapier is available at \`./vendor/rapier.es.js\` if physics are useful.

## Workflow

- Preserve a playable loop after each change: controls, objective, feedback, and restart or scoring.
- Prefer \`index.html\` and \`src/main.js\` unless the user asks for more structure.
- Make controls visible in the game UI and summarize them when responding.
- If the preview reports an error, inspect the referenced file/line before editing.
`

const GAMEBLOCKS_SKILL_MD = `---
name: gameblocks
description: Build and repair self-contained browser 3D games for Game Studio projects.
---

# GameBlocks

Use this skill whenever the user asks to create, modify, debug, or polish the game in this directory.

## Runtime contract

- The game must run from \`index.html\` in a localhost static preview.
- Keep everything self-contained in this project. Do not use CDNs, external image URLs, external audio URLs, or remote fonts.
- Use the scaffolded import map for Three.js: \`import * as THREE from 'three'\`.
- If physics are needed, import Rapier from \`./vendor/rapier.es.js\` and keep the game playable if physics initialization fails.
- Prefer plain ES modules, Canvas/WebGL, and small local assets generated in code.

## Required game loop

Every generated or edited game should include:

1. A clear objective visible in the UI.
2. Keyboard/mouse/touch controls documented on screen.
3. Immediate feedback for success, failure, score, health, time, or progress.
4. A restart path after win/loss or when the player gets stuck.
5. A resilient render loop that does not crash if assets are missing.

## Debugging workflow

- When runtime errors are reported, inspect the referenced source location before editing.
- Fix root causes, not just symptoms, and keep the game playable after the fix.
- After significant edits, summarize the controls and what changed.

## File conventions

- Keep the main implementation in \`src/main.js\` unless more files clearly simplify the design.
- Do not edit \`vendor/\` files.
- Do not remove \`project.json\`, \`AGENTS.md\`, or this skill.
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
