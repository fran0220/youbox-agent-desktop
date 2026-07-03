/**
 * Game Studio Atoms
 *
 * Workspace-scoped project metadata is loaded by AppShell and consumed by
 * GameStudioPage / project switching UI. null means "still loading"; an empty
 * array means the workspace has no Game Studio projects.
 */

import { atom } from 'jotai'
import type { GameProjectMeta } from '@craft-agent/shared/protocol'

export const gamestudioProjectsAtom = atom<GameProjectMeta[] | null>(null)

export interface PendingGameProjectRename {
  projectId: string
  draft: string
}

/**
 * ProjectPickerOverlay lives inside the keyed GameStudioProjectShell. Creating
 * from the picker navigates to the new project and remounts that shell, so the
 * inline rename target must be kept outside the keyed subtree.
 */
export const pendingGameProjectRenameAtom = atom<PendingGameProjectRename | null>(null)

export function createPendingGameProjectRename(project: GameProjectMeta): PendingGameProjectRename {
  return {
    projectId: project.id,
    draft: project.name,
  }
}

export function resolveGameProjectRenameCommit(
  pendingRename: PendingGameProjectRename | null,
  project: GameProjectMeta,
): { projectId: string; name: string } | null {
  if (pendingRename?.projectId !== project.id) return null
  const name = pendingRename.draft.trim()
  if (!name || name === project.name) return null
  return { projectId: project.id, name }
}

/** Project opened when entering Game Studio without an explicit project id. */
export function mostRecentGameProject(projects: readonly GameProjectMeta[]): GameProjectMeta | null {
  let best: GameProjectMeta | null = null
  for (const project of projects) {
    if (!best || project.updatedAt > best.updatedAt) best = project
  }
  return best
}

/** Display order for project pickers and fallback navigation. */
export function sortGameProjectsByUpdatedAtDesc(projects: readonly GameProjectMeta[]): GameProjectMeta[] {
  return [...projects].sort((a, b) => b.updatedAt - a.updatedAt)
}
