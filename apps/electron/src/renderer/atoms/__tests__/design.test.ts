import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { DesignProjectMeta } from '@craft-agent/shared/protocol'
import {
  buildDesignPreviewUrl,
  createPendingDesignProjectRename,
  designProjectsAtom,
  DESIGN_PROTOTYPE_DEVICE_WIDTHS,
  getDesignPreviewFrameStyle,
  mostRecentDesignProject,
  pendingDesignProjectRenameAtom,
  resolveDesignProjectRenameCommit,
  sortDesignProjectsByUpdatedAtDesc,
} from '../design'

function project(id: string, updatedAt: number, name = id): DesignProjectMeta {
  return {
    id,
    name,
    kind: 'prototype',
    sessionId: null,
    designSystemId: null,
    templateId: null,
    entryFile: 'index.html',
    thumbnailPath: null,
    createdAt: updatedAt - 1,
    updatedAt,
    version: 1,
  }
}

describe('design project atoms', () => {
  it('starts project metadata as null so loading is distinct from empty', () => {
    const store = createStore()
    expect(store.get(designProjectsAtom)).toBeNull()
  })

  it('selects the project with the newest updatedAt', () => {
    expect(mostRecentDesignProject([])).toBeNull()
    expect(mostRecentDesignProject([
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

    expect(sortDesignProjectsByUpdatedAtDesc(source).map(p => p.id)).toEqual(['newest', 'middle', 'older'])
    expect(source.map(p => p.id)).toEqual(['older', 'newest', 'middle'])
  })

  it('keeps a pending inline rename across project shell remounts after create', () => {
    const store = createStore()
    const created = project('created-from-gallery', 500)

    store.set(pendingDesignProjectRenameAtom, createPendingDesignProjectRename(created))
    store.set(designProjectsAtom, [created, project('existing', 100)])

    expect(store.get(pendingDesignProjectRenameAtom)).toEqual({
      projectId: 'created-from-gallery',
      draft: 'created-from-gallery',
    })
  })

  it('resolves inline rename commits while preserving unicode and long names', () => {
    const created = project('created-from-gallery', 500, 'Untitled Design')
    const pending = createPendingDesignProjectRename(created)
    const unicodeName = '  设计🎨مرحبا Untitled design with a very long name that should persist exactly  '
    const edited = { ...pending, draft: unicodeName }

    expect(resolveDesignProjectRenameCommit(edited, created)).toEqual({
      projectId: 'created-from-gallery',
      name: unicodeName.trim(),
    })
    expect(resolveDesignProjectRenameCommit({ ...edited, projectId: 'other' }, created)).toBeNull()
    expect(resolveDesignProjectRenameCommit({ ...edited, draft: created.name }, created)).toBeNull()
    expect(resolveDesignProjectRenameCommit({ ...edited, draft: '   ' }, created)).toBeNull()
  })

  it('builds cache-busted design protocol URLs with encoded segments', () => {
    expect(buildDesignPreviewUrl('workspace one', 'project/id', 'slides/index.html', 7)).toBe(
      'design://project/workspace%20one/project%2Fid/slides/index.html?reload=7',
    )
    expect(buildDesignPreviewUrl('ws', 'proj', 'index.html', 0)).toBe(
      'design://project/ws/proj/index.html?reload=0',
    )
  })

  it('returns kind-specific preview frame styles', () => {
    expect(getDesignPreviewFrameStyle('deck', 'desktop')).toEqual({
      aspectRatio: '16 / 9',
      width: 'min(100%, calc((100vh - 11rem) * 16 / 9))',
    })
    expect(getDesignPreviewFrameStyle('prototype', 'tablet')).toEqual({
      maxWidth: DESIGN_PROTOTYPE_DEVICE_WIDTHS.tablet,
      width: '100%',
    })
    expect(getDesignPreviewFrameStyle('doc', 'desktop')).toEqual({
      maxWidth: 900,
      width: '100%',
    })
    expect(getDesignPreviewFrameStyle('image', 'mobile')).toEqual({
      maxWidth: 960,
      width: '100%',
    })
  })
})
