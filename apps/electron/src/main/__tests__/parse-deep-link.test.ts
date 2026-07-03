import { describe, expect, it } from 'bun:test'
import { parseDeepLink } from '../deep-link'

describe('parseDeepLink', () => {
  it('accepts originai:// compound routes', () => {
    expect(parseDeepLink('originai://settings/shortcuts')).toEqual({
      workspaceId: undefined,
      view: 'settings/shortcuts',
      windowMode: undefined,
      rightSidebar: undefined,
    })
  })

  it('accepts legacy origincoworks:// compound routes', () => {
    expect(parseDeepLink('origincoworks://settings/shortcuts')).toEqual({
      workspaceId: undefined,
      view: 'settings/shortcuts',
      windowMode: undefined,
      rightSidebar: undefined,
    })
  })

  it('accepts originai:// action routes', () => {
    expect(parseDeepLink('originai://action/new-session?input=hi')).toMatchObject({
      action: 'new-session',
      actionParams: { input: 'hi' },
    })
  })

  it('accepts legacy origincoworks:// action routes', () => {
    expect(parseDeepLink('origincoworks://action/new-session?input=hi')).toMatchObject({
      action: 'new-session',
      actionParams: { input: 'hi' },
    })
  })

  it('rejects craftagents:// URLs (legacy scheme)', () => {
    expect(parseDeepLink('craftagents://settings')).toBeNull()
  })

  it('returns null for auth-callback (handled elsewhere)', () => {
    expect(parseDeepLink('origincoworks://auth-callback?code=1')).toBeNull()
  })

  it('accepts origincoworks://gamestudio compound routes', () => {
    expect(parseDeepLink('origincoworks://gamestudio')).toEqual({
      workspaceId: undefined,
      view: 'gamestudio',
      windowMode: undefined,
      rightSidebar: undefined,
    })
    expect(parseDeepLink('origincoworks://gamestudio/project/proj-42')).toEqual({
      workspaceId: undefined,
      view: 'gamestudio/project/proj-42',
      windowMode: undefined,
      rightSidebar: undefined,
    })
  })

  it('accepts origincoworks://design compound routes', () => {
    expect(parseDeepLink('origincoworks://design')).toEqual({
      workspaceId: undefined,
      view: 'design',
      windowMode: undefined,
      rightSidebar: undefined,
    })
    expect(parseDeepLink('origincoworks://design/project/proj-42')).toEqual({
      workspaceId: undefined,
      view: 'design/project/proj-42',
      windowMode: undefined,
      rightSidebar: undefined,
    })
  })
})
