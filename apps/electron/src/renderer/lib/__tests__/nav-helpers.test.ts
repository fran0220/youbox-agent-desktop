import { describe, it, expect } from 'bun:test'
import { isDetailNavState } from '../nav-helpers'
import type { NavigationState } from '../../../shared/types'

describe('isDetailNavState', () => {
  it('returns false for null nav state', () => {
    expect(isDetailNavState(null)).toBe(false)
  })

  it('sessions: detail only when a session is selected', () => {
    const list: NavigationState = { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null }
    const detail: NavigationState = { navigator: 'sessions', filter: { kind: 'allSessions' }, details: { type: 'session', sessionId: 's1' } }
    expect(isDetailNavState(list)).toBe(false)
    expect(isDetailNavState(detail)).toBe(true)
  })

  it('settings: detail only when a subpage is selected', () => {
    expect(isDetailNavState({ navigator: 'settings', subpage: null })).toBe(false)
    expect(isDetailNavState({ navigator: 'settings', subpage: 'app' })).toBe(true)
  })

  it('sources/skills/automations: detail only when an item is selected', () => {
    expect(isDetailNavState({ navigator: 'sources', details: null })).toBe(false)
    expect(isDetailNavState({ navigator: 'sources', details: { type: 'source', sourceSlug: 'a' } })).toBe(true)
    expect(isDetailNavState({ navigator: 'skills', details: null })).toBe(false)
    expect(isDetailNavState({ navigator: 'skills', details: { type: 'skill', skillSlug: 'a' } })).toBe(true)
    expect(isDetailNavState({ navigator: 'automations', details: null })).toBe(false)
    expect(isDetailNavState({ navigator: 'automations', details: { type: 'automation', automationId: 'a' } })).toBe(true)
  })

  it('studio: always content-focused (no navigator list to fall back to)', () => {
    expect(isDetailNavState({ navigator: 'studio', kind: null, details: null })).toBe(true)
    expect(isDetailNavState({ navigator: 'studio', kind: 'canvas', details: null })).toBe(true)
    expect(isDetailNavState({ navigator: 'studio', kind: 'game', details: { type: 'artifact', artifactId: 'p1' } })).toBe(true)
  })
})
