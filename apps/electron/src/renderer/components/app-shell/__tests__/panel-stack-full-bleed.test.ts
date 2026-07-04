import { describe, expect, it } from 'bun:test'

import { resolvePanelChromeHidden } from '@/lib/full-bleed-routes'

describe('PanelStackContainer full-bleed route chrome', () => {
  it('keeps studio home and kind routes controlled by the parent chrome state', () => {
    expect(resolvePanelChromeHidden(false, 'studio')).toBe(false)
    expect(resolvePanelChromeHidden(false, 'studio/game')).toBe(false)
    expect(resolvePanelChromeHidden(false, 'studio/canvas')).toBe(false)
    expect(resolvePanelChromeHidden(false, 'studio/design')).toBe(false)
  })

  it('forces sidebar and navigator hidden for studio artifact detail routes even when parent chrome state is stale', () => {
    expect(resolvePanelChromeHidden(false, 'studio/game/test-project')).toBe(true)
  })

  it('keeps work routes controlled by the parent chrome state', () => {
    expect(resolvePanelChromeHidden(false, 'allSessions')).toBe(false)
    expect(resolvePanelChromeHidden(true, 'allSessions')).toBe(true)
  })

  it('preserves canvas artifact full-bleed behavior under studio', () => {
    expect(resolvePanelChromeHidden(false, 'studio/canvas/test-doc')).toBe(true)
  })

  it('forces sidebar and navigator hidden for design artifact routes under studio', () => {
    expect(resolvePanelChromeHidden(false, 'studio/design/test-project')).toBe(true)
  })
})
