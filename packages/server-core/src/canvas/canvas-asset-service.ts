/**
 * Canvas asset import.
 *
 * Copies an existing, workspace-confined image file into a doc's per-doc asset
 * dir (<workspace>/canvas/assets/{docId}/) so a dropped/referenced image becomes
 * a portable, confined asset instead of an absolute path that could point
 * outside the canvas. The doc is NOT mutated here — the caller (renderer) creates
 * the node pointing at the returned assetPath.
 *
 * SECURITY: the source path is confined to the workspace via
 * {@link isPathWithinWorkspace} (realpath + symlink resolution) so a traversal,
 * an escaping symlink, or an unrelated absolute path is rejected before any read.
 * Never throws for expected failures and never leaks secrets — returns a typed
 * result.
 */

import { readFile, stat } from 'fs/promises'
import type { Stats } from 'fs'
import { extname } from 'path'
import { randomUUID } from 'crypto'
import type {
  CanvasImportAssetError,
  CanvasImportAssetErrorCode,
  CanvasImportAssetResult,
} from '@craft-agent/shared/protocol'
import { isPathWithinWorkspace, loadCanvasDoc, writeCanvasAsset } from './canvas-storage'

/** Allowed source extensions (portable, web-renderable image formats). */
export const IMPORTABLE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

/** Reject source files larger than this (bytes). */
export const IMPORT_ASSET_MAX_BYTES = 25 * 1024 * 1024

export interface CanvasImportAssetParams {
  docId: string
  sourcePath: string
}

export interface CanvasImportAssetDeps {
  /** Size cap override (bytes) — tests inject a small value. */
  maxBytes?: number
  logger?: { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void }
}

function fail(code: CanvasImportAssetErrorCode, message: string): CanvasImportAssetError {
  return { ok: false, code, message }
}

export async function importCanvasAsset(
  workspaceRootPath: string,
  params: CanvasImportAssetParams,
  deps: CanvasImportAssetDeps = {},
): Promise<CanvasImportAssetResult> {
  const { docId, sourcePath } = params
  const log = deps.logger
  const maxBytes = deps.maxBytes ?? IMPORT_ASSET_MAX_BYTES

  if (!sourcePath || typeof sourcePath !== 'string') {
    return fail('source_not_found', 'source path is required')
  }

  const doc = loadCanvasDoc(workspaceRootPath, docId)
  if (!doc) return fail('doc_not_found', `Canvas doc not found: ${docId}`)

  // Existence + file check (follows symlinks). Missing → source_not_found.
  let sourceStat: Stats
  try {
    sourceStat = await stat(sourcePath)
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err && err.code === 'ENOENT') return fail('source_not_found', 'source file does not exist')
    return fail('io_error', `failed to read source file: ${err?.message ?? String(error)}`)
  }
  if (!sourceStat.isFile()) return fail('source_not_found', 'source path is not a file')

  const ext = extname(sourcePath).toLowerCase()
  if (!IMPORTABLE_IMAGE_EXTENSIONS.has(ext)) {
    return fail('invalid_image', `unsupported image type: ${ext || '(none)'}`)
  }

  if (sourceStat.size > maxBytes) {
    return fail('invalid_image', `image exceeds the ${maxBytes}-byte size limit`)
  }

  // Confine AFTER existence/type checks so distinct failures stay distinguishable,
  // and BEFORE reading so an escaping path is never read. realpath resolves
  // symlinks — an inside link pointing outside the workspace is rejected here.
  if (!(await isPathWithinWorkspace(workspaceRootPath, sourcePath))) {
    return fail('forbidden_path', 'source path is outside the workspace')
  }

  let bytes: Buffer
  try {
    bytes = await readFile(sourcePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log?.error?.(`CANVAS_IMPORT_ASSET: failed to read source for doc ${docId}`)
    return fail('io_error', `failed to read source file: ${message}`)
  }

  const fileName = `${randomUUID()}${ext}`
  let assetPath: string
  try {
    assetPath = await writeCanvasAsset(workspaceRootPath, docId, fileName, bytes)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log?.error?.(`CANVAS_IMPORT_ASSET: failed to write asset for doc ${docId}`)
    return fail('io_error', `failed to write asset: ${message}`)
  }

  log?.info?.(`CANVAS_IMPORT_ASSET: imported asset into doc ${docId}`)
  return { ok: true, assetPath, fileName }
}
