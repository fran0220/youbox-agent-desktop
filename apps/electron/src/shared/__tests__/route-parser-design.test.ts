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

describe('route-parser: design studio routes', () => {
  it('recognizes canonical studio design routes and legacy design aliases', () => {
    expect(isCompoundRoute('studio/design')).toBe(true)
    expect(isCompoundRoute('studio/design/proj-1')).toBe(true)
    expect(isCompoundRoute('design')).toBe(true)
    expect(isCompoundRoute('design/project/proj-1')).toBe(true)
  })

  it('parses legacy design routes into studio design navigation', () => {
    expect(parseCompoundRoute('design')).toEqual({ navigator: 'studio', studioKind: 'design', details: null })
    expect(parseCompoundRoute('design/project/abc')).toEqual({
      navigator: 'studio',
      studioKind: 'design',
      details: { type: 'artifact', id: 'abc' },
    })
  })

  it('serializes design navigation to canonical studio routes', () => {
    expect(buildCompoundRoute(parseCompoundRoute('design')!)).toBe('studio/design')
    expect(buildCompoundRoute(parseCompoundRoute('design/project/abc')!)).toBe('studio/design/abc')

    const root: NavigationState = { navigator: 'studio', kind: 'design', details: null }
    expect(buildRouteFromNavigationState(root)).toBe('studio/design')

    const withProject: NavigationState = {
      navigator: 'studio',
      kind: 'design',
      details: { type: 'artifact', artifactId: 'proj-42' },
    }
    const route = buildRouteFromNavigationState(withProject)
    expect(route).toBe('studio/design/proj-42')
    expect(parseRouteToNavigationState(route)).toEqual(withProject)
  })

  it('parses canonical and legacy design routes to StudioNavigationState', () => {
    for (const route of ['studio/design/abc', 'design/project/abc']) {
      const state = parseRouteToNavigationState(route)
      expect(state).not.toBeNull()
      expect(isStudioNavigation(state!)).toBe(true)
      if (isStudioNavigation(state!)) {
        expect(state.kind).toBe('design')
        expect(state.details).toEqual({ type: 'artifact', artifactId: 'abc' })
      }
    }
  })

  it('routes.view.design compatibility builder emits canonical studio routes', () => {
    expect(routes.view.design()).toBe('studio/design')
    expect(routes.view.design('abc')).toBe('studio/design/abc')
  })
})
