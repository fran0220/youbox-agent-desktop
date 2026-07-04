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

describe('route-parser: canvas studio routes', () => {
  it('recognizes canonical studio canvas routes and legacy canvas aliases', () => {
    expect(isCompoundRoute('studio/canvas')).toBe(true)
    expect(isCompoundRoute('studio/canvas/doc-1')).toBe(true)
    expect(isCompoundRoute('canvas')).toBe(true)
    expect(isCompoundRoute('canvas/doc/doc-1')).toBe(true)
  })

  it('parses legacy canvas routes into studio canvas navigation', () => {
    expect(parseCompoundRoute('canvas')).toEqual({ navigator: 'studio', studioKind: 'canvas', details: null })
    expect(parseCompoundRoute('canvas/doc/abc')).toEqual({
      navigator: 'studio',
      studioKind: 'canvas',
      details: { type: 'artifact', id: 'abc' },
    })
  })

  it('serializes canvas navigation to canonical studio routes', () => {
    expect(buildCompoundRoute(parseCompoundRoute('canvas')!)).toBe('studio/canvas')
    expect(buildCompoundRoute(parseCompoundRoute('canvas/doc/abc')!)).toBe('studio/canvas/abc')

    const root: NavigationState = { navigator: 'studio', kind: 'canvas', details: null }
    expect(buildRouteFromNavigationState(root)).toBe('studio/canvas')

    const withDoc: NavigationState = {
      navigator: 'studio',
      kind: 'canvas',
      details: { type: 'artifact', artifactId: 'doc-42' },
    }
    const route = buildRouteFromNavigationState(withDoc)
    expect(route).toBe('studio/canvas/doc-42')
    expect(parseRouteToNavigationState(route)).toEqual(withDoc)
  })

  it('parses canonical and legacy canvas routes to StudioNavigationState', () => {
    for (const route of ['studio/canvas/abc', 'canvas/doc/abc']) {
      const state = parseRouteToNavigationState(route)
      expect(state).not.toBeNull()
      expect(isStudioNavigation(state!)).toBe(true)
      if (isStudioNavigation(state!)) {
        expect(state.kind).toBe('canvas')
        expect(state.details).toEqual({ type: 'artifact', artifactId: 'abc' })
      }
    }
  })

  it('routes.view.canvas compatibility builder emits canonical studio routes', () => {
    expect(routes.view.studio()).toBe('studio')
    expect(routes.view.studio('canvas')).toBe('studio/canvas')
    expect(routes.view.canvas()).toBe('studio/canvas')
    expect(routes.view.canvas('doc-1')).toBe('studio/canvas/doc-1')
  })
})
