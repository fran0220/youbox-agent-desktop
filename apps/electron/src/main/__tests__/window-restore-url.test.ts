import { describe, expect, it } from 'bun:test'

import {
  buildDevRestoredWindowUrl,
  buildRestoredWindowQuery,
  sanitizeRestoredWindowSearch,
} from '../window-restore-url'

describe('window restore URL sanitization', () => {
  it('rewrites workspace identity while preserving the restored route', () => {
    const params = sanitizeRestoredWindowSearch(
      'http://localhost:5199/index.html?workspaceId=workspace-a-id&ws=workspace-a&route=design/project/project-a&focused=true',
      'workspace-b-id',
      'workspace-b',
      false,
    )

    expect(params.get('workspaceId')).toBe('workspace-b-id')
    expect(params.get('ws')).toBe('workspace-b')
    expect(params.get('route')).toBe('design/project/project-a')
    expect(params.has('focused')).toBe(false)
  })

  it('builds a dev URL against the current dev server with sanitized workspace params', () => {
    const restored = buildDevRestoredWindowUrl(
      'file:///old/app/index.html?workspaceId=workspace-a-id&ws=workspace-a&route=design/project/project-a',
      'http://localhost:5199/',
      'workspace-b-id',
      'workspace-b',
      true,
    )

    expect(restored).toBe('http://localhost:5199/old/app/index.html?workspaceId=workspace-b-id&ws=workspace-b&route=design%2Fproject%2Fproject-a&focused=true')
  })

  it('builds a production loadFile query with sanitized workspace params', () => {
    const query = buildRestoredWindowQuery(
      'file:///old/app/index.html?workspaceId=workspace-a-id&ws=workspace-a&route=design/project/project-a',
      'workspace-b-id',
      'workspace-b',
      false,
    )

    expect(query).toEqual({
      workspaceId: 'workspace-b-id',
      ws: 'workspace-b',
      route: 'design/project/project-a',
    })
  })
})
