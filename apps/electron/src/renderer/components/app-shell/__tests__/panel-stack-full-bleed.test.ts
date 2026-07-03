import { describe, expect, it } from 'bun:test'

import { resolvePanelChromeHidden } from '@/lib/full-bleed-routes'

describe('PanelStackContainer full-bleed route chrome', () => {
  it('forces sidebar and navigator hidden for gamestudio routes even when parent chrome state is stale', () => {
    expect(resolvePanelChromeHidden(false, 'gamestudio')).toBe(true)
    expect(resolvePanelChromeHidden(false, 'gamestudio/project/test-project')).toBe(true)
  })

  it('keeps work routes controlled by the parent chrome state', () => {
    expect(resolvePanelChromeHidden(false, 'allSessions')).toBe(false)
    expect(resolvePanelChromeHidden(true, 'allSessions')).toBe(true)
  })

  it('preserves canvas full-bleed behavior', () => {
    expect(resolvePanelChromeHidden(false, 'canvas')).toBe(true)
    expect(resolvePanelChromeHidden(false, 'canvas/doc/test-doc')).toBe(true)
  })
})
