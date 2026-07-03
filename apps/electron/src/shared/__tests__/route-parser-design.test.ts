import { describe, it, expect } from 'bun:test'
import {
  parseCompoundRoute,
  buildCompoundRoute,
  isCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
} from '../route-parser'
import { routes } from '../routes'
import { isDesignNavigation, isGameStudioNavigation } from '../types'
import type { NavigationState } from '../types'

describe('route-parser: design routes', () => {
  it('recognizes "design" as a compound route', () => {
    expect(isCompoundRoute('design')).toBe(true)
    expect(isCompoundRoute('design/project/proj-1')).toBe(true)
  })

  it('parses "design" as design navigator with no details', () => {
    const result = parseCompoundRoute('design')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('design')
    expect(result!.details).toBeNull()
  })

  it('parses "design/project/proj-1" as design navigator with project details', () => {
    const result = parseCompoundRoute('design/project/proj-1')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('design')
    expect(result!.details).toEqual({ type: 'project', id: 'proj-1' })
  })

  it('rejects unknown design subroutes', () => {
    expect(parseCompoundRoute('design/bogus')).toBeNull()
    expect(parseCompoundRoute('design/project')).toBeNull()
  })

  it('roundtrips design (no details)', () => {
    const parsed = parseCompoundRoute('design')!
    const built = buildCompoundRoute(parsed)
    expect(built).toBe('design')
  })

  it('roundtrips design/project/proj-1', () => {
    const parsed = parseCompoundRoute('design/project/proj-1')!
    const built = buildCompoundRoute(parsed)
    expect(built).toBe('design/project/proj-1')
  })

  it('parses "design" to DesignNavigationState', () => {
    const state = parseRouteToNavigationState('design')
    expect(state).not.toBeNull()
    expect(state!.navigator).toBe('design')
    expect(isDesignNavigation(state!)).toBe(true)
    if (isDesignNavigation(state!)) {
      expect(state!.details).toBeNull()
    }
  })

  it('parses "design/project/abc" to DesignNavigationState with project details', () => {
    const state = parseRouteToNavigationState('design/project/abc')
    expect(state).not.toBeNull()
    expect(isDesignNavigation(state!)).toBe(true)
    if (isDesignNavigation(state!)) {
      expect(state!.details).toEqual({ type: 'project', projectId: 'abc' })
    }
  })

  it('roundtrips DesignNavigationState through buildRouteFromNavigationState', () => {
    const root: NavigationState = { navigator: 'design', details: null }
    expect(buildRouteFromNavigationState(root)).toBe('design')

    const withProject: NavigationState = {
      navigator: 'design',
      details: { type: 'project', projectId: 'proj-42' },
    }
    const route = buildRouteFromNavigationState(withProject)
    expect(route).toBe('design/project/proj-42')
    expect(parseRouteToNavigationState(route)).toEqual(withProject)
  })

  it('routes.view.design builders emit design routes', () => {
    expect(routes.view.design()).toBe('design')
    expect(routes.view.design('abc')).toBe('design/project/abc')
  })

  it('isDesignNavigation is specific to design states', () => {
    const design: NavigationState = { navigator: 'design', details: null }
    const gamestudio: NavigationState = { navigator: 'gamestudio', details: null }
    expect(isDesignNavigation(design)).toBe(true)
    expect(isDesignNavigation(gamestudio)).toBe(false)
    expect(isGameStudioNavigation(design)).toBe(false)
  })
})
