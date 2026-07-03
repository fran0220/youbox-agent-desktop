import { describe, it, expect } from 'bun:test'
import {
  parseCompoundRoute,
  buildCompoundRoute,
  isCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
} from '../route-parser'
import { routes } from '../routes'
import { isCanvasNavigation } from '../types'
import type { NavigationState } from '../types'

describe('route-parser: canvas routes', () => {
  it('recognizes "canvas" as a compound route', () => {
    expect(isCompoundRoute('canvas')).toBe(true)
    expect(isCompoundRoute('canvas/doc/doc-1')).toBe(true)
  })

  it('parses "canvas" as canvas navigator with no details', () => {
    const result = parseCompoundRoute('canvas')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('canvas')
    expect(result!.details).toBeNull()
  })

  it('parses "canvas/doc/doc-1" as canvas navigator with doc details', () => {
    const result = parseCompoundRoute('canvas/doc/doc-1')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('canvas')
    expect(result!.details).toEqual({ type: 'doc', id: 'doc-1' })
  })

  it('rejects unknown canvas subroutes', () => {
    expect(parseCompoundRoute('canvas/bogus')).toBeNull()
    expect(parseCompoundRoute('canvas/doc')).toBeNull()
  })

  it('roundtrips canvas (no details)', () => {
    const parsed = parseCompoundRoute('canvas')!
    const built = buildCompoundRoute(parsed)
    expect(built).toBe('canvas')
  })

  it('roundtrips canvas/doc/doc-1', () => {
    const parsed = parseCompoundRoute('canvas/doc/doc-1')!
    const built = buildCompoundRoute(parsed)
    expect(built).toBe('canvas/doc/doc-1')
  })

  it('parses "canvas" to CanvasNavigationState', () => {
    const state = parseRouteToNavigationState('canvas')
    expect(state).not.toBeNull()
    expect(state!.navigator).toBe('canvas')
    expect(isCanvasNavigation(state!)).toBe(true)
    if (isCanvasNavigation(state!)) {
      expect(state!.details).toBeNull()
    }
  })

  it('parses "canvas/doc/abc" to CanvasNavigationState with doc details', () => {
    const state = parseRouteToNavigationState('canvas/doc/abc')
    expect(state).not.toBeNull()
    expect(isCanvasNavigation(state!)).toBe(true)
    if (isCanvasNavigation(state!)) {
      expect(state!.details).toEqual({ type: 'doc', docId: 'abc' })
    }
  })

  it('roundtrips CanvasNavigationState through buildRouteFromNavigationState', () => {
    const root: NavigationState = { navigator: 'canvas', details: null }
    expect(buildRouteFromNavigationState(root)).toBe('canvas')

    const withDoc: NavigationState = {
      navigator: 'canvas',
      details: { type: 'doc', docId: 'doc-42' },
    }
    const route = buildRouteFromNavigationState(withDoc)
    expect(route).toBe('canvas/doc/doc-42')
    expect(parseRouteToNavigationState(route)).toEqual(withDoc)
  })

  it('routes.view.canvas builders emit canvas routes', () => {
    expect(routes.view.canvas()).toBe('canvas')
    expect(routes.view.canvas('doc-1')).toBe('canvas/doc/doc-1')
  })
})
