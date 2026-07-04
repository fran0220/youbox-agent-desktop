import { describe, it, expect } from 'bun:test'
import {
  parseCompoundRoute,
  buildCompoundRoute,
  isCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
} from '../route-parser'
import { routes } from '../routes'
import { isStudioNavigation } from '../types'
import type { NavigationState } from '../types'

describe('route-parser: game studio routes', () => {
  it('recognizes canonical studio game routes and legacy gamestudio aliases', () => {
    expect(isCompoundRoute('studio/game')).toBe(true)
    expect(isCompoundRoute('studio/game/proj-1')).toBe(true)
    expect(isCompoundRoute('gamestudio')).toBe(true)
    expect(isCompoundRoute('gamestudio/project/proj-1')).toBe(true)
  })

  it('parses legacy gamestudio routes into studio game navigation', () => {
    expect(parseCompoundRoute('gamestudio')).toEqual({ navigator: 'studio', studioKind: 'game', details: null })
    expect(parseCompoundRoute('gamestudio/project/abc')).toEqual({
      navigator: 'studio',
      studioKind: 'game',
      details: { type: 'artifact', id: 'abc' },
    })
  })

  it('serializes game navigation to canonical studio routes', () => {
    expect(buildCompoundRoute(parseCompoundRoute('gamestudio')!)).toBe('studio/game')
    expect(buildCompoundRoute(parseCompoundRoute('gamestudio/project/abc')!)).toBe('studio/game/abc')

    const root: NavigationState = { navigator: 'studio', kind: 'game', details: null }
    expect(buildRouteFromNavigationState(root)).toBe('studio/game')

    const withProject: NavigationState = {
      navigator: 'studio',
      kind: 'game',
      details: { type: 'artifact', artifactId: 'proj-42' },
    }
    const route = buildRouteFromNavigationState(withProject)
    expect(route).toBe('studio/game/proj-42')
    expect(parseRouteToNavigationState(route)).toEqual(withProject)
  })

  it('parses canonical and legacy game routes to StudioNavigationState', () => {
    for (const route of ['studio/game/abc', 'gamestudio/project/abc']) {
      const state = parseRouteToNavigationState(route)
      expect(state).not.toBeNull()
      expect(isStudioNavigation(state!)).toBe(true)
      if (isStudioNavigation(state!)) {
        expect(state.kind).toBe('game')
        expect(state.details).toEqual({ type: 'artifact', artifactId: 'abc' })
      }
    }
  })

  it('routes.view.gamestudio compatibility builder emits canonical studio routes', () => {
    expect(routes.view.gamestudio()).toBe('studio/game')
    expect(routes.view.gamestudio('proj-1')).toBe('studio/game/proj-1')
  })
})
