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

/** Project opened when entering Game Studio without an explicit project id. */
export function mostRecentGameProject(projects: readonly GameProjectMeta[]): GameProjectMeta | null {
  let best: GameProjectMeta | null = null
  for (const project of projects) {
    if (!best || project.updatedAt > best.updatedAt) best = project
  }
  return best
}
