import { describe, expect, it } from 'bun:test'

import { selectInitialWindowWorkspaceId } from '../workspace-selection'

describe('selectInitialWindowWorkspaceId', () => {
  it('keeps the workspace assigned to the current window when it exists', () => {
    expect(selectInitialWindowWorkspaceId('workspace-b', [
      { id: 'workspace-a' },
      { id: 'workspace-b' },
    ])).toBe('workspace-b')
  })

  it('falls back to the first workspace when the window workspace is missing', () => {
    expect(selectInitialWindowWorkspaceId('missing', [
      { id: 'workspace-a' },
      { id: 'workspace-b' },
    ])).toBe('workspace-a')
  })

  it('returns null when there are no workspaces', () => {
    expect(selectInitialWindowWorkspaceId(null, [])).toBeNull()
  })
})
