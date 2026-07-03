/**
 * Canvas document storage — workspace-scoped JSON persistence.
 *
 * Layout (mirrors sessions/, sources/, skills/ workspace conventions):
 *   <workspace>/canvas/{docId}.json          — one document per file
 *   <workspace>/canvas/assets/{docId}/       — generated assets (created lazily, used from M3)
 *
 * Writes are atomic (tmp + rename, same as the sessions persistence queue)
 * and serialized per doc so concurrent RPC mutations cannot interleave on the
 * same file. Conflict resolution is last-write-wins: every update rewrites the
 * whole doc and bumps `version`; the final writer's state is what persists.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { mkdir, realpath, rename, rm, unlink, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { basename, dirname, isAbsolute, join, relative } from 'path'
import type {
  CanvasDoc,
  CanvasDocCreateInput,
  CanvasDocMeta,
  CanvasDocState,
  CanvasDocUpdateInput,
  CanvasEdgeDto,
  CanvasImageNodeData,
  CanvasImageNodeDto,
  CanvasNodeDto,
  CanvasTextNodeData,
} from '@craft-agent/shared/protocol'

export const CANVAS_SCHEMA_VERSION = 1

/**
 * Hard cap on the number of nodes a single canvas doc may hold. Enforced in the
 * append path ({@link addCanvasNode}) so a runaway agent loop on
 * canvas_create_node cannot grow a doc unboundedly (every create rewrites the
 * whole doc — O(N^2)). Shared constant so the tool path and any other caller
 * observe the same limit.
 */
export const CANVAS_MAX_NODES = 500

/** On-disk shape of a canvas doc file */
export interface StoredCanvasDoc extends CanvasDoc {
  schemaVersion: number
}

const DOC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

function assertValidDocId(docId: string): void {
  if (!docId || typeof docId !== 'string' || basename(docId) !== docId || !DOC_ID_PATTERN.test(docId)) {
    throw new Error(`Invalid canvas doc id: ${JSON.stringify(docId)}`)
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getWorkspaceCanvasDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'canvas')
}

export function getCanvasDocPath(workspaceRootPath: string, docId: string): string {
  assertValidDocId(docId)
  return join(getWorkspaceCanvasDir(workspaceRootPath), `${docId}.json`)
}

export function getCanvasAssetsDir(workspaceRootPath: string, docId: string): string {
  assertValidDocId(docId)
  return join(getWorkspaceCanvasDir(workspaceRootPath), 'assets', docId)
}

/**
 * True when `target` is the same path as, or nested under, `boundary`. Compares
 * already-resolved (realpath'd) paths — see {@link isPathWithinWorkspace}.
 */
function isContainedPath(boundary: string, target: string): boolean {
  if (target === boundary) return true
  const rel = relative(boundary, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Security boundary for reference-image reads (canvas:generateImage).
 *
 * Resolves symlinks and normalizes both the workspace root and the candidate
 * path via `realpath`, then verifies the candidate stays inside the workspace.
 * Any path that escapes the workspace after symlink resolution — traversal
 * (`../`), a symlink pointing outside, or an unrelated absolute path — is
 * rejected. The candidate must exist (it has to, to be read); a missing path or
 * any fs error resolves to `false` (skip, never read).
 *
 * This confines the arbitrary-absolute-path read surface (referenceImagePaths
 * and client-writable node.filePath) so it cannot exfiltrate files outside the
 * workspace.
 */
export async function isPathWithinWorkspace(workspaceRootPath: string, candidatePath: string): Promise<boolean> {
  if (!candidatePath || typeof candidatePath !== 'string') return false
  try {
    const rootReal = await realpath(workspaceRootPath)
    const candidateReal = await realpath(candidatePath)
    return isContainedPath(rootReal, candidateReal)
  } catch {
    return false
  }
}

/**
 * Confinement variant scoped to a doc's asset dir
 * (`<workspace>/canvas/assets/{docId}/`). Same realpath/symlink semantics as
 * {@link isPathWithinWorkspace}; use when reads should be limited to a single
 * doc's generated assets rather than the whole workspace.
 */
export async function isPathWithinCanvasAssets(
  workspaceRootPath: string,
  docId: string,
  candidatePath: string,
): Promise<boolean> {
  if (!candidatePath || typeof candidatePath !== 'string') return false
  try {
    const assetsReal = await realpath(getCanvasAssetsDir(workspaceRootPath, docId))
    const candidateReal = await realpath(candidatePath)
    return isContainedPath(assetsReal, candidateReal)
  } catch {
    return false
  }
}

/** Create the per-doc assets dir on first use (image generation lands here in M3) */
export function ensureCanvasAssetsDir(workspaceRootPath: string, docId: string): string {
  const dir = getCanvasAssetsDir(workspaceRootPath, docId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function emptyCanvasDocState(): CanvasDocState {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

// ---------------------------------------------------------------------------
// Per-doc serialized write queue (same guarantees as the sessions
// persistence queue: atomic tmp+rename, one writer per doc at a time)
// ---------------------------------------------------------------------------

class CanvasWriteQueue {
  private tails = new Map<string, Promise<void>>()

  /** Run `task` after all previously enqueued tasks for the same key settle. */
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

const writeQueue = new CanvasWriteQueue()

async function writeDocFileAtomic(filePath: string, doc: StoredCanvasDoc): Promise<void> {
  // Serialize before touching disk — a serialization failure must not corrupt
  // the existing file.
  const json = JSON.stringify(doc, null, 2)
  await mkdir(dirname(filePath), { recursive: true })

  const tmpFile = filePath + '.tmp'
  try {
    await writeFile(tmpFile, json, 'utf-8')
    // On Windows, rename fails if target exists. Delete first for cross-platform compatibility.
    try { await unlink(filePath) } catch { /* ignore if doesn't exist */ }
    await rename(tmpFile, filePath)
  } catch (error) {
    try { await unlink(tmpFile) } catch { /* best-effort cleanup */ }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function parseStoredDoc(raw: string): StoredCanvasDoc | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCanvasDoc>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null
    return {
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : CANVAS_SCHEMA_VERSION,
      id: parsed.id,
      name: typeof parsed.name === 'string' ? parsed.name : 'Untitled',
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      chatSessionId: typeof parsed.chatSessionId === 'string' ? parsed.chatSessionId : undefined,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      viewport: parsed.viewport ?? { x: 0, y: 0, zoom: 1 },
    }
  } catch {
    return null
  }
}

function toDoc(stored: StoredCanvasDoc): CanvasDoc {
  const { schemaVersion: _schemaVersion, ...doc } = stored
  return doc
}

function toMeta(doc: CanvasDoc): CanvasDocMeta {
  const meta: CanvasDocMeta = {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    version: doc.version,
  }
  if (doc.chatSessionId) meta.chatSessionId = doc.chatSessionId
  return meta
}

export function loadCanvasDoc(workspaceRootPath: string, docId: string): CanvasDoc | null {
  const filePath = getCanvasDocPath(workspaceRootPath, docId)
  if (!existsSync(filePath)) return null
  const stored = parseStoredDoc(readFileSync(filePath, 'utf-8'))
  return stored ? toDoc(stored) : null
}

export function listCanvasDocs(workspaceRootPath: string): CanvasDocMeta[] {
  const dir = getWorkspaceCanvasDir(workspaceRootPath)
  if (!existsSync(dir)) return []

  const metas: CanvasDocMeta[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const stored = parseStoredDoc(readFileSync(join(dir, entry.name), 'utf-8'))
      if (stored) metas.push(toMeta(toDoc(stored)))
    } catch {
      // unreadable file — skip
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---------------------------------------------------------------------------
// Mutations (serialized per doc)
// ---------------------------------------------------------------------------

export async function createCanvasDoc(
  workspaceRootPath: string,
  input: CanvasDocCreateInput = {},
): Promise<CanvasDoc> {
  const docId = randomUUID()
  const now = Date.now()
  const state = input.state ?? emptyCanvasDocState()
  const doc: CanvasDoc = {
    id: docId,
    name: input.name ?? 'Untitled',
    createdAt: now,
    updatedAt: now,
    version: 1,
    nodes: state.nodes,
    edges: state.edges,
    viewport: state.viewport,
  }
  await writeQueue.enqueue(docQueueKey(workspaceRootPath, docId), () =>
    writeDocFileAtomic(getCanvasDocPath(workspaceRootPath, docId), { schemaVersion: CANVAS_SCHEMA_VERSION, ...doc }),
  )
  return doc
}

export async function updateCanvasDoc(
  workspaceRootPath: string,
  docId: string,
  patch: CanvasDocUpdateInput,
): Promise<CanvasDoc> {
  const filePath = getCanvasDocPath(workspaceRootPath, docId)
  return writeQueue.enqueue(docQueueKey(workspaceRootPath, docId), async () => {
    const current = loadCanvasDoc(workspaceRootPath, docId)
    if (!current) throw new Error(`Canvas doc not found: ${docId}`)

    const state = patch.state
    const next: CanvasDoc = {
      ...current,
      name: patch.name ?? current.name,
      nodes: state ? state.nodes : current.nodes,
      edges: state ? state.edges : current.edges,
      viewport: state ? state.viewport : current.viewport,
      updatedAt: Date.now(),
      version: current.version + 1,
    }
    await writeDocFileAtomic(filePath, { schemaVersion: CANVAS_SCHEMA_VERSION, ...next })
    return next
  })
}

/**
 * Bind (or clear) the hidden chat-session id in the doc's metadata.
 *
 * This is a metadata-only write: it deliberately does NOT bump `version` and
 * leaves `updatedAt` untouched, so a session bind never registers as a content
 * change (no spurious list re-ordering or last-write-wins churn against real
 * edits). Serialized on the same per-doc queue as every other mutation. Pass
 * `undefined` to unbind. Returns the updated doc, or null if the doc is missing.
 */
export async function setCanvasDocChatSessionId(
  workspaceRootPath: string,
  docId: string,
  sessionId: string | undefined,
): Promise<CanvasDoc | null> {
  const filePath = getCanvasDocPath(workspaceRootPath, docId)
  return writeQueue.enqueue(docQueueKey(workspaceRootPath, docId), async () => {
    const current = loadCanvasDoc(workspaceRootPath, docId)
    if (!current) return null

    const next: CanvasDoc = { ...current, chatSessionId: sessionId }
    await writeDocFileAtomic(filePath, { schemaVersion: CANVAS_SCHEMA_VERSION, ...next })
    return next
  })
}

// ---------------------------------------------------------------------------
// Image assets (M3 — canvas:generateImage)
// ---------------------------------------------------------------------------

/**
 * Atomically write a binary asset (generated PNG) into the per-doc assets dir.
 * tmp + rename, same durability guarantees as the doc writer. Returns the
 * absolute path of the written file. `fileName` must be a bare basename.
 */
export async function writeCanvasAsset(
  workspaceRootPath: string,
  docId: string,
  fileName: string,
  data: Buffer,
): Promise<string> {
  if (basename(fileName) !== fileName || !fileName) {
    throw new Error(`Invalid canvas asset file name: ${JSON.stringify(fileName)}`)
  }
  const dir = ensureCanvasAssetsDir(workspaceRootPath, docId)
  const filePath = join(dir, fileName)
  const tmpFile = filePath + '.tmp'
  try {
    await writeFile(tmpFile, data)
    try { await unlink(filePath) } catch { /* ignore if doesn't exist */ }
    await rename(tmpFile, filePath)
  } catch (error) {
    try { await unlink(tmpFile) } catch { /* best-effort cleanup */ }
    throw error
  }
  return filePath
}

function buildImageNode(
  id: string,
  position: { x: number; y: number },
  filePath: string,
  fileName: string,
  extra: Record<string, unknown> = {},
): CanvasImageNodeDto {
  return { ...extra, id, type: 'image', position, data: { filePath, fileName } }
}

/**
 * Insert or backfill an image node pointing at a written asset, serialized on
 * the per-doc write queue so it can't interleave with other doc mutations.
 *
 * - When `nodeId` matches an existing node, that node is converted in place to
 *   an image node (position and other React Flow fields preserved).
 * - When `nodeId` is given but absent, a new image node is created with that id
 *   (so a client-side placeholder id round-trips).
 * - When `nodeId` is omitted, a new image node with a fresh id is appended at a
 *   sensible offset from existing content.
 *
 * Bumps `version` (last-write-wins) exactly like {@link updateCanvasDoc}.
 */
export async function addOrBackfillCanvasImageNode(
  workspaceRootPath: string,
  docId: string,
  params: { nodeId?: string; filePath: string; fileName: string },
): Promise<{ doc: CanvasDoc; nodeId: string }> {
  const filePath = getCanvasDocPath(workspaceRootPath, docId)
  return writeQueue.enqueue(docQueueKey(workspaceRootPath, docId), async () => {
    const current = loadCanvasDoc(workspaceRootPath, docId)
    if (!current) throw new Error(`Canvas doc not found: ${docId}`)

    const nodes: CanvasNodeDto[] = [...current.nodes]
    let targetId = params.nodeId
    const existingIdx = targetId ? nodes.findIndex(n => n.id === targetId) : -1

    if (existingIdx >= 0) {
      const prev = nodes[existingIdx]!
      const { id: _id, type: _type, data: _data, position, ...extra } = prev as CanvasNodeDto & Record<string, unknown>
      nodes[existingIdx] = buildImageNode(prev.id, position, params.filePath, params.fileName, extra)
    } else {
      const id = targetId ?? randomUUID()
      targetId = id
      const position = { x: 80 + nodes.length * 48, y: 80 + nodes.length * 24 }
      nodes.push(buildImageNode(id, position, params.filePath, params.fileName))
    }

    const next: CanvasDoc = {
      ...current,
      nodes,
      updatedAt: Date.now(),
      version: current.version + 1,
    }
    await writeDocFileAtomic(filePath, { schemaVersion: CANVAS_SCHEMA_VERSION, ...next })
    return { doc: next, nodeId: targetId! }
  })
}

// ---------------------------------------------------------------------------
// Node / edge mutations (M4 — agent canvas_* tools). Each loads, mutates and
// writes inside the per-doc serialized queue so tool-driven edits can't
// interleave with RPC-driven edits on the same file. All bump `version`
// (last-write-wins), consistent with {@link addOrBackfillCanvasImageNode}.
// ---------------------------------------------------------------------------

export interface CanvasNodeInput {
  type: 'image' | 'text'
  position: { x: number; y: number }
  data: CanvasImageNodeData | CanvasTextNodeData
  /** Optional explicit id (a client-side placeholder id). A fresh uuid is used when omitted. */
  id?: string
}

export interface CanvasNodePatch {
  position?: { x: number; y: number }
  text?: string
  width?: number
  height?: number
}

/** Append a new image or text node. Rejects a duplicate explicit id. */
export async function addCanvasNode(
  workspaceRootPath: string,
  docId: string,
  input: CanvasNodeInput,
): Promise<{ doc: CanvasDoc; nodeId: string }> {
  const filePath = getCanvasDocPath(workspaceRootPath, docId)
  return writeQueue.enqueue(docQueueKey(workspaceRootPath, docId), async () => {
    const current = loadCanvasDoc(workspaceRootPath, docId)
    if (!current) throw new Error(`Canvas doc not found: ${docId}`)

    if (current.nodes.length >= CANVAS_MAX_NODES) {
      throw new Error(`canvas node limit reached (max ${CANVAS_MAX_NODES})`)
    }

    const nodeId = input.id ?? randomUUID()
    if (current.nodes.some(n => n.id === nodeId)) {
      throw new Error(`Canvas node already exists: ${nodeId}`)
    }

    const node = {
      id: nodeId,
      type: input.type,
      position: input.position,
      data: input.data,
    } as CanvasNodeDto

    const next: CanvasDoc = {
      ...current,
      nodes: [...current.nodes, node],
      updatedAt: Date.now(),
      version: current.version + 1,
    }
    await writeDocFileAtomic(filePath, { schemaVersion: CANVAS_SCHEMA_VERSION, ...next })
    return { doc: next, nodeId }
  })
}

/** Update an existing node's position/size, and text for text nodes. */
export async function updateCanvasNode(
  workspaceRootPath: string,
  docId: string,
  nodeId: string,
  patch: CanvasNodePatch,
): Promise<{ doc: CanvasDoc; nodeId: string }> {
  const filePath = getCanvasDocPath(workspaceRootPath, docId)
  return writeQueue.enqueue(docQueueKey(workspaceRootPath, docId), async () => {
    const current = loadCanvasDoc(workspaceRootPath, docId)
    if (!current) throw new Error(`Canvas doc not found: ${docId}`)

    const idx = current.nodes.findIndex(n => n.id === nodeId)
    if (idx < 0) throw new Error(`Canvas node not found: ${nodeId}`)

    const prev = current.nodes[idx]! as CanvasNodeDto & Record<string, unknown>
    if (patch.text !== undefined && prev.type !== 'text') {
      throw new Error(`Cannot set text on a ${prev.type} node: ${nodeId}`)
    }

    const nextNode: CanvasNodeDto & Record<string, unknown> = { ...prev }
    if (patch.position) nextNode.position = patch.position
    if (patch.width !== undefined) nextNode.width = patch.width
    if (patch.height !== undefined) nextNode.height = patch.height
    if (patch.text !== undefined) nextNode.data = { text: patch.text }

    const nodes = [...current.nodes]
    nodes[idx] = nextNode as CanvasNodeDto

    const next: CanvasDoc = {
      ...current,
      nodes,
      updatedAt: Date.now(),
      version: current.version + 1,
    }
    await writeDocFileAtomic(filePath, { schemaVersion: CANVAS_SCHEMA_VERSION, ...next })
    return { doc: next, nodeId }
  })
}

/** Connect two existing nodes with a directed edge. Both node ids must exist. */
export async function addCanvasEdge(
  workspaceRootPath: string,
  docId: string,
  params: { source: string; target: string; id?: string },
): Promise<{ doc: CanvasDoc; edgeId: string }> {
  const filePath = getCanvasDocPath(workspaceRootPath, docId)
  return writeQueue.enqueue(docQueueKey(workspaceRootPath, docId), async () => {
    const current = loadCanvasDoc(workspaceRootPath, docId)
    if (!current) throw new Error(`Canvas doc not found: ${docId}`)

    if (params.source === params.target) {
      throw new Error('Cannot connect a node to itself')
    }
    if (!current.nodes.some(n => n.id === params.source)) {
      throw new Error(`Canvas node not found: ${params.source}`)
    }
    if (!current.nodes.some(n => n.id === params.target)) {
      throw new Error(`Canvas node not found: ${params.target}`)
    }

    const edgeId = params.id ?? randomUUID()
    if (current.edges.some(e => e.id === edgeId)) {
      throw new Error(`Canvas edge already exists: ${edgeId}`)
    }

    const edge: CanvasEdgeDto = { id: edgeId, source: params.source, target: params.target }
    const next: CanvasDoc = {
      ...current,
      edges: [...current.edges, edge],
      updatedAt: Date.now(),
      version: current.version + 1,
    }
    await writeDocFileAtomic(filePath, { schemaVersion: CANVAS_SCHEMA_VERSION, ...next })
    return { doc: next, edgeId }
  })
}

/** Returns true when a doc file was actually removed (idempotent otherwise) */
export async function deleteCanvasDoc(workspaceRootPath: string, docId: string): Promise<boolean> {
  const filePath = getCanvasDocPath(workspaceRootPath, docId)
  const assetsDir = getCanvasAssetsDir(workspaceRootPath, docId)
  return writeQueue.enqueue(docQueueKey(workspaceRootPath, docId), async () => {
    if (!existsSync(filePath)) return false
    await rm(filePath, { force: true })
    await rm(assetsDir, { recursive: true, force: true })
    return true
  })
}

function docQueueKey(workspaceRootPath: string, docId: string): string {
  return `${workspaceRootPath}::${docId}`
}
