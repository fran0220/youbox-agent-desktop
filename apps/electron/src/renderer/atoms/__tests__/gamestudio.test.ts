import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { GameProjectMeta } from '@craft-agent/shared/protocol'
import { gamestudioProjectsAtom, mostRecentGameProject } from '../gamestudio'

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
})
