/**
 * Design Atoms
 *
 * Workspace-scoped project metadata is loaded by AppShell and consumed by
 * DesignStudioPage. null means "still loading"; an empty array means the
 * workspace has no Design projects.
 */

import { atom } from 'jotai'
import type { CSSProperties } from 'react'
import type { DesignArtifactKind, DesignProjectMeta } from '@craft-agent/shared/protocol'

export const designProjectsAtom = atom<DesignProjectMeta[] | null>(null)

export const designChatSessionIdsAtom = atom<Record<string, string>>({})

export interface PendingDesignProjectRename {
  projectId: string
  draft: string
}

export const pendingDesignProjectRenameAtom = atom<PendingDesignProjectRename | null>(null)

export const seedDesignChatSessionIdAtom = atom(
  null,
  (get, set, { projectId, sessionId }: { projectId: string; sessionId: string | null | undefined }) => {
    if (!sessionId) return
    const current = get(designChatSessionIdsAtom)
    if (current[projectId] === sessionId) return
    set(designChatSessionIdsAtom, { ...current, [projectId]: sessionId })
  },
)

export type DesignPrototypeDevice = 'desktop' | 'tablet' | 'mobile'

export const DESIGN_PROTOTYPE_DEVICE_WIDTHS: Record<DesignPrototypeDevice, number> = {
  desktop: 1200,
  mobile: 390,
  tablet: 768,
}

export function createPendingDesignProjectRename(project: DesignProjectMeta): PendingDesignProjectRename {
  return {
    projectId: project.id,
    draft: project.name,
  }
}

export function resolveDesignProjectRenameCommit(
  pendingRename: PendingDesignProjectRename | null,
  project: DesignProjectMeta,
): { projectId: string; name: string } | null {
  if (pendingRename?.projectId !== project.id) return null
  const name = pendingRename.draft.trim()
  if (!name || name === project.name) return null
  return { projectId: project.id, name }
}

export function mostRecentDesignProject(projects: readonly DesignProjectMeta[]): DesignProjectMeta | null {
  let best: DesignProjectMeta | null = null
  for (const project of projects) {
    if (!best || project.updatedAt > best.updatedAt) best = project
  }
  return best
}

export function sortDesignProjectsByUpdatedAtDesc(projects: readonly DesignProjectMeta[]): DesignProjectMeta[] {
  return [...projects].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function buildDesignPreviewUrl(
  workspaceId: string,
  projectId: string,
  entryFile: string,
  reloadToken: number,
): string {
  const encodedEntry = entryFile
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `design://project/${encodeURIComponent(workspaceId)}/${encodeURIComponent(projectId)}/${encodedEntry}?reload=${reloadToken}`
}

export function getDesignPreviewFrameStyle(
  kind: DesignArtifactKind,
  device: DesignPrototypeDevice,
): CSSProperties {
  if (kind === 'deck') {
    return {
      aspectRatio: '16 / 9',
      width: 'min(100%, calc((100vh - 11rem) * 16 / 9))',
    }
  }

  if (kind === 'prototype') {
    return {
      maxWidth: DESIGN_PROTOTYPE_DEVICE_WIDTHS[device],
      width: '100%',
    }
  }

  return {
    maxWidth: kind === 'doc' ? 900 : 960,
    width: '100%',
  }
}
