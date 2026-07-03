/**
 * Canvas drag-and-drop helpers — dragging an image out of a chat message and
 * dropping it onto the canvas creates an image node at the drop position.
 *
 * The drag payload is a small JSON descriptor carried under a private MIME
 * type. On drop the referenced image is COPIED into the doc's per-doc asset
 * dir (canvas:importAsset) so the node points at a portable, workspace-confined
 * asset rather than the chat attachment's absolute path (which could be deleted
 * or live outside canvas/assets).
 */

import type { XYPosition } from '@xyflow/react'
import type { CanvasImportAssetRequest } from '@craft-agent/shared/protocol'
import { createImageNode, type CanvasImageNode } from '@/atoms/canvas'

/** Private MIME type for the chat-image drag payload */
export const CANVAS_IMAGE_DND_MIME = 'application/x-origin-canvas-image'

export interface DroppedImageRef {
  /** Absolute path to the source image on disk */
  filePath: string
  /** Optional display name (falls back to the path basename) */
  fileName?: string
}

interface DataTransferLike {
  getData(type: string): string
}

/** Serialize a drag payload for dataTransfer.setData(CANVAS_IMAGE_DND_MIME, …) */
export function serializeCanvasImageDrag(ref: DroppedImageRef): string {
  return JSON.stringify(ref)
}

/**
 * True when a drag carries a canvas image (checked during dragover, where
 * getData is blocked and only the type list is readable).
 */
export function dataTransferHasCanvasImage(types: readonly string[] | undefined | null): boolean {
  if (!types) return false
  return Array.from(types).includes(CANVAS_IMAGE_DND_MIME)
}

/**
 * Parse a dropped canvas-image payload. Accepts the JSON descriptor and also
 * tolerates a bare path string. Returns null when the drop carries no valid
 * image reference.
 */
export function parseCanvasImageDrop(dt: DataTransferLike | null | undefined): DroppedImageRef | null {
  if (!dt) return null
  const raw = dt.getData(CANVAS_IMAGE_DND_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DroppedImageRef>
    if (parsed && typeof parsed.filePath === 'string' && parsed.filePath.trim()) {
      return {
        filePath: parsed.filePath,
        fileName: typeof parsed.fileName === 'string' ? parsed.fileName : undefined,
      }
    }
    return null
  } catch {
    return raw.trim() ? { filePath: raw.trim() } : null
  }
}

/** Build the image node for a dropped image reference at a flow position */
export function imageNodeFromDrop(ref: DroppedImageRef, position: XYPosition): CanvasImageNode {
  return createImageNode(ref.filePath, position)
}

/** Build the canvas:importAsset request that copies a dropped ref into the doc */
export function importRequestFromDrop(
  ref: DroppedImageRef,
  ctx: { workspaceId: string; docId: string },
): CanvasImportAssetRequest {
  return { workspaceId: ctx.workspaceId, docId: ctx.docId, sourcePath: ref.filePath }
}

/**
 * Build the image node for an imported asset at a flow position. The node
 * points at the COPIED assetPath; the original drag ref's display name is
 * preserved as the caption when present (the asset basename is a bare uuid).
 */
export function imageNodeFromImportedAsset(
  assetPath: string,
  position: XYPosition,
  displayName?: string,
): CanvasImageNode {
  const node = createImageNode(assetPath, position)
  const name = displayName?.trim()
  return name ? { ...node, data: { ...node.data, fileName: name } } : node
}
