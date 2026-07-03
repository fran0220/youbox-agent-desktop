import { describe, it, expect } from 'bun:test'
import {
  parseCompoundRoute,
  buildCompoundRoute,
  isCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
} from '../route-parser'
import { routes } from '../routes'
import { isGameStudioNavigation } from '../types'
import type { NavigationState } from '../types'

describe('route-parser: gamestudio routes', () => {
  it('recognizes "gamestudio" as a compound route', () => {
    expect(isCompoundRoute('gamestudio')).toBe(true)
    expect(isCompoundRoute('gamestudio/project/proj-1')).toBe(true)
  })

  it('parses "gamestudio" as gamestudio navigator with no details', () => {
    const result = parseCompoundRoute('gamestudio')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('gamestudio')
    expect(result!.details).toBeNull()
  })

  it('parses "gamestudio/project/proj-1" as gamestudio navigator with project details', () => {
    const result = parseCompoundRoute('gamestudio/project/proj-1')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('gamestudio')
    expect(result!.details).toEqual({ type: 'project', id: 'proj-1' })
  })

  it('rejects unknown gamestudio subroutes', () => {
    expect(parseCompoundRoute('gamestudio/bogus')).toBeNull()
    expect(parseCompoundRoute('gamestudio/project')).toBeNull()
  })

  it('roundtrips gamestudio (no details)', () => {
    const parsed = parseCompoundRoute('gamestudio')!
    const built = buildCompoundRoute(parsed)
    expect(built).toBe('gamestudio')
  })

  it('roundtrips gamestudio/project/proj-1', () => {
    const parsed = parseCompoundRoute('gamestudio/project/proj-1')!
    const built = buildCompoundRoute(parsed)
    expect(built).toBe('gamestudio/project/proj-1')
  })

  it('parses "gamestudio" to GameStudioNavigationState', () => {
    const state = parseRouteToNavigationState('gamestudio')
    expect(state).not.toBeNull()
    expect(state!.navigator).toBe('gamestudio')
    expect(isGameStudioNavigation(state!)).toBe(true)
    if (isGameStudioNavigation(state!)) {
      expect(state!.details).toBeNull()
    }
  })

  it('parses "gamestudio/project/abc" to GameStudioNavigationState with project details', () => {
    const state = parseRouteToNavigationState('gamestudio/project/abc')
    expect(state).not.toBeNull()
    expect(isGameStudioNavigation(state!)).toBe(true)
    if (isGameStudioNavigation(state!)) {
      expect(state!.details).toEqual({ type: 'project', projectId: 'abc' })
    }
  })

  it('roundtrips GameStudioNavigationState through buildRouteFromNavigationState', () => {
    const root: NavigationState = { navigator: 'gamestudio', details: null }
    expect(buildRouteFromNavigationState(root)).toBe('gamestudio')

    const withProject: NavigationState = {
      navigator: 'gamestudio',
      details: { type: 'project', projectId: 'proj-42' },
    }
    const route = buildRouteFromNavigationState(withProject)
    expect(route).toBe('gamestudio/project/proj-42')
    expect(parseRouteToNavigationState(route)).toEqual(withProject)
  })

  it('routes.view.gamestudio builders emit gamestudio routes', () => {
    expect(routes.view.gamestudio()).toBe('gamestudio')
    expect(routes.view.gamestudio('proj-1')).toBe('gamestudio/project/proj-1')
  })
})
