import { describe, it, expect } from 'bun:test'
import { APP_MODES, DEFAULT_APP_MODE_ID, getAppMode, getAppModeForNavigation } from '../app-modes'
import type { NavigationState } from '../types'
import { isStudioNavigation } from '../types'

const sessionsState: NavigationState = {
  navigator: 'sessions',
  filter: { kind: 'allSessions' },
  details: null,
}
const sourcesState: NavigationState = { navigator: 'sources', details: null }
const settingsState: NavigationState = { navigator: 'settings', subpage: null }
const skillsState: NavigationState = { navigator: 'skills', details: null }
const automationsState: NavigationState = { navigator: 'automations', details: null }
const studioState: NavigationState = { navigator: 'studio', kind: null, details: null }
const studioCanvasState: NavigationState = {
  navigator: 'studio',
  kind: 'canvas',
  details: { type: 'artifact', artifactId: 'doc-1' },
}
const studioGameState: NavigationState = {
  navigator: 'studio',
  kind: 'game',
  details: { type: 'artifact', artifactId: 'proj-1' },
}
const studioDesignState: NavigationState = {
  navigator: 'studio',
  kind: 'design',
  details: { type: 'artifact', artifactId: 'proj-1' },
}

describe('app-modes registry', () => {
  it('exposes work and studio modes in order', () => {
    expect(APP_MODES.map((m) => m.id)).toEqual(['work', 'studio'])
  })

  it('defaults to the work mode', () => {
    expect(DEFAULT_APP_MODE_ID).toBe('work')
  })

  it('getAppMode returns the mode definition by id', () => {
    expect(getAppMode('work').id).toBe('work')
    expect(getAppMode('studio').id).toBe('studio')
  })

  it('work mode matches non-studio navigators', () => {
    const work = getAppMode('work')
    expect(work.matches(sessionsState)).toBe(true)
    expect(work.matches(sourcesState)).toBe(true)
    expect(work.matches(settingsState)).toBe(true)
    expect(work.matches(skillsState)).toBe(true)
    expect(work.matches(automationsState)).toBe(true)
  })

  it('work mode does not match studio navigation', () => {
    const work = getAppMode('work')
    expect(work.matches(studioState)).toBe(false)
    expect(work.matches(studioCanvasState)).toBe(false)
    expect(work.matches(studioGameState)).toBe(false)
    expect(work.matches(studioDesignState)).toBe(false)
  })

  it('studio mode matches all studio kinds', () => {
    const studio = getAppMode('studio')
    expect(studio.matches(studioState)).toBe(true)
    expect(studio.matches(studioCanvasState)).toBe(true)
    expect(studio.matches(studioGameState)).toBe(true)
    expect(studio.matches(studioDesignState)).toBe(true)
    expect(isStudioNavigation(studioGameState)).toBe(true)
    expect(studio.matches(sessionsState)).toBe(false)
  })

  it('defaultRoute returns navigable view routes', () => {
    expect(getAppMode('work').defaultRoute()).toBe('allSessions')
    expect(getAppMode('studio').defaultRoute()).toBe('studio')
  })

  it('getAppModeForNavigation derives the mode from navigation state', () => {
    expect(getAppModeForNavigation(sessionsState).id).toBe('work')
    expect(getAppModeForNavigation(settingsState).id).toBe('work')
    expect(getAppModeForNavigation(studioState).id).toBe('studio')
    expect(getAppModeForNavigation(studioCanvasState).id).toBe('studio')
    expect(getAppModeForNavigation(studioGameState).id).toBe('studio')
    expect(getAppModeForNavigation(studioDesignState).id).toBe('studio')
  })

  it('every mode declares a labelKey and iconId for the renderer', () => {
    for (const mode of APP_MODES) {
      expect(mode.labelKey.length).toBeGreaterThan(0)
      expect(mode.iconId.length).toBeGreaterThan(0)
    }
  })
})
