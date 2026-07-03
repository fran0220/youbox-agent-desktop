import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { GameProjectMeta } from '@craft-agent/shared/protocol'
import {
  createPendingGameProjectRename,
  gamestudioProjectsAtom,
  mostRecentGameProject,
  pendingGameProjectRenameAtom,
  resolveGameProjectRenameCommit,
  sortGameProjectsByUpdatedAtDesc,
} from '../gamestudio'

function project(id: string, updatedAt: number): GameProjectMeta {
  return {
    id,
    name: id,
    sessionId: null,
    thumbnailPath: null,
    createdAt: updatedAt - 1,
    updatedAt,
    version: 1,
  }
}

describe('gamestudio project atoms', () => {
  it('starts project metadata as null so loading is distinct from empty', () => {
    const store = createStore()
    expect(store.get(gamestudioProjectsAtom)).toBeNull()
  })

  it('selects the project with the newest updatedAt', () => {
    expect(mostRecentGameProject([])).toBeNull()
    expect(mostRecentGameProject([
      project('older', 100),
      project('newest', 300),
      project('middle', 200),
    ])?.id).toBe('newest')
  })

  it('sorts project metadata by updatedAt descending without mutating the source list', () => {
    const source = [
      project('older', 100),
      project('newest', 300),
      project('middle', 200),
    ]

    expect(sortGameProjectsByUpdatedAtDesc(source).map(p => p.id)).toEqual(['newest', 'middle', 'older'])
    expect(source.map(p => p.id)).toEqual(['older', 'newest', 'middle'])
  })

  it('keeps a pending inline rename across project shell remounts after picker create', () => {
    const store = createStore()
    const created = project('created-from-picker', 500)

    store.set(pendingGameProjectRenameAtom, createPendingGameProjectRename(created))

    // Creating inside the picker navigates to gamestudio/project/{id}, which
    // remounts the keyed project shell. The pending rename must live outside
    // that keyed subtree so the new row still renders as an input afterward.
    store.set(gamestudioProjectsAtom, [created, project('existing', 100)])

    expect(store.get(pendingGameProjectRenameAtom)).toEqual({
      projectId: 'created-from-picker',
      draft: 'created-from-picker',
    })
  })

  it('resolves the picker create inline rename Enter path into a project rename update', () => {
    const created = project('created-from-picker', 500)
    const pending = createPendingGameProjectRename(created)
    const edited = { ...pending, draft: ' test-new-name ' }

    expect(resolveGameProjectRenameCommit(edited, created)).toEqual({
      projectId: 'created-from-picker',
      name: 'test-new-name',
    })
    expect(resolveGameProjectRenameCommit({ ...edited, projectId: 'other' }, created)).toBeNull()
    expect(resolveGameProjectRenameCommit({ ...edited, draft: created.name }, created)).toBeNull()
  })
})
