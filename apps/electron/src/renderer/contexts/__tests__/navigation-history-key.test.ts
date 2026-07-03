import { describe, expect, it } from 'bun:test'
import {
  buildSemanticHistoryKey,
  canReplaceUrlForStateSync,
  canRunInitialRestore,
  selectInitialRestoreSearch,
} from '../navigation-history'

describe('buildSemanticHistoryKey', () => {
  it('changes when focused panel index changes even if routes are identical', () => {
    const panelRoutes = ['allSessions/session/s1', 'allSessions/session/s1']

    const keyA = buildSemanticHistoryKey({
      workspaceSlug: 'ws',
      panelRoutes,
      focusedPanelIndex: 0,
      sidebarParam: '',
    })

    const keyB = buildSemanticHistoryKey({
      workspaceSlug: 'ws',
      panelRoutes,
      focusedPanelIndex: 1,
      sidebarParam: '',
    })

    expect(keyA).not.toBe(keyB)
  })

  it('stays stable for identical semantic inputs', () => {
    const input = {
      workspaceSlug: 'ws',
      panelRoutes: ['allSessions/session/s1', 'sources/source/github'],
      focusedPanelIndex: 1,
      sidebarParam: 'files',
    }

    const keyA = buildSemanticHistoryKey(input)
    const keyB = buildSemanticHistoryKey(input)

    expect(keyA).toBe(keyB)
  })
})

describe('canReplaceUrlForStateSync', () => {
  it('returns false before initial route restoration', () => {
    expect(canReplaceUrlForStateSync({
      initialRouteRestored: false,
      pushPending: false,
    })).toBe(false)
  })

  it('returns false while a semantic history push is pending', () => {
    expect(canReplaceUrlForStateSync({
      initialRouteRestored: true,
      pushPending: true,
    })).toBe(false)
  })

  it('returns true once restored with no pending push', () => {
    expect(canReplaceUrlForStateSync({
      initialRouteRestored: true,
      pushPending: false,
    })).toBe(true)
  })
})

describe('canRunInitialRestore', () => {
  it('returns false until session metadata is ready', () => {
    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: false,
      workspaceId: 'ws-1',
      initialRouteRestored: false,
    })).toBe(false)
  })

  it('returns true only when all restore conditions are satisfied', () => {
    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: true,
      workspaceId: 'ws-1',
      initialRouteRestored: false,
    })).toBe(true)

    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: true,
      workspaceId: 'ws-1',
      initialRouteRestored: true,
    })).toBe(false)
  })
})

describe('selectInitialRestoreSearch', () => {
  it('keeps a current restored design route ahead of saved workspace session state', () => {
    const selected = selectInitialRestoreSearch({
      currentSearch: '?workspaceId=ws-1&route=design',
      savedWorkspaceSearch: '?ws=workspace&route=allSessions/session/s1',
    })

    expect(selected).toBe('?workspaceId=ws-1&route=design')
  })

  it('keeps current restored mode routes ahead of saved workspace session state', () => {
    for (const route of ['canvas', 'gamestudio']) {
      const selected = selectInitialRestoreSearch({
        currentSearch: `?workspaceId=ws-1&route=${route}`,
        savedWorkspaceSearch: '?ws=workspace&route=allSessions/session/s1',
      })

      expect(selected).toBe(`?workspaceId=ws-1&route=${route}`)
    }
  })

  it('keeps a current restored work-mode session route', () => {
    const selected = selectInitialRestoreSearch({
      currentSearch: '?workspaceId=ws-1&route=allSessions/session/s2',
      savedWorkspaceSearch: '?ws=workspace&route=allSessions/session/s1',
    })

    expect(selected).toBe('?workspaceId=ws-1&route=allSessions/session/s2')
  })

  it('keeps current restored panel state ahead of saved workspace state', () => {
    const selected = selectInitialRestoreSearch({
      currentSearch: '?workspaceId=ws-1&route=design&panels=design:1.0000&fi=0',
      savedWorkspaceSearch: '?ws=workspace&route=allSessions/session/s1',
    })

    expect(selected).toBe('?workspaceId=ws-1&route=design&panels=design:1.0000&fi=0')
  })

  it('uses saved workspace state when the current URL has no restore route', () => {
    const selected = selectInitialRestoreSearch({
      currentSearch: '?workspaceId=ws-1',
      savedWorkspaceSearch: '?ws=workspace&route=allSessions/session/s1',
    })

    expect(selected).toBe('?ws=workspace&route=allSessions/session/s1')
  })
})
