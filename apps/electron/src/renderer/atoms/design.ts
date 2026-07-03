/**
 * Design Atoms
 *
 * Workspace-scoped project metadata is loaded by AppShell and consumed by
 * DesignStudioPage. null means "still loading"; an empty array means the
 * workspace has no Design projects.
 */

import { atom } from 'jotai'
import type { DesignProjectMeta } from '@craft-agent/shared/protocol'

export const designProjectsAtom = atom<DesignProjectMeta[] | null>(null)

export interface PendingDesignProjectRename {
  projectId: string
  draft: string
}

export const pendingDesignProjectRenameAtom = atom<PendingDesignProjectRename | null>(null)

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
