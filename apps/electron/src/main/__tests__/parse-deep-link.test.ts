import { describe, expect, it } from 'bun:test'
import { parseDeepLink } from '../deep-link'

describe('parseDeepLink', () => {
  it('accepts origincoworks:// compound routes', () => {
    expect(parseDeepLink('origincoworks://settings/shortcuts')).toEqual({
      workspaceId: undefined,
      view: 'settings/shortcuts',
      windowMode: undefined,
      rightSidebar: undefined,
    })
  })

  it('accepts origincoworks:// action routes', () => {
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
})
