import { describe, it, expect } from 'bun:test'
import { APP_MODES, DEFAULT_APP_MODE_ID, getAppMode, getAppModeForNavigation } from '../app-modes'
import type { NavigationState } from '../types'
import { isDesignNavigation, isGameStudioNavigation } from '../types'

const sessionsState: NavigationState = {
  navigator: 'sessions',
  filter: { kind: 'allSessions' },
  details: null,
}
const sourcesState: NavigationState = { navigator: 'sources', details: null }
const settingsState: NavigationState = { navigator: 'settings', subpage: null }
const skillsState: NavigationState = { navigator: 'skills', details: null }
const automationsState: NavigationState = { navigator: 'automations', details: null }
const canvasState: NavigationState = { navigator: 'canvas', details: null }
const canvasDocState: NavigationState = {
  navigator: 'canvas',
  details: { type: 'doc', docId: 'doc-1' },
}
const gamestudioState: NavigationState = { navigator: 'gamestudio', details: null }
const gamestudioProjectState: NavigationState = {
  navigator: 'gamestudio',
  details: { type: 'project', projectId: 'proj-1' },
}
const designState: NavigationState = { navigator: 'design', details: null }
const designProjectState: NavigationState = {
  navigator: 'design',
  details: { type: 'project', projectId: 'proj-1' },
}

describe('app-modes registry', () => {
  it('exposes work, canvas, gamestudio, and design modes in order', () => {
    expect(APP_MODES.map((m) => m.id)).toEqual(['work', 'canvas', 'gamestudio', 'design'])
  })

  it('defaults to the work mode', () => {
    expect(DEFAULT_APP_MODE_ID).toBe('work')
  })

  it('getAppMode returns the mode definition by id', () => {
    expect(getAppMode('work').id).toBe('work')
    expect(getAppMode('canvas').id).toBe('canvas')
  })

  it('work mode matches all existing navigators', () => {
    const work = getAppMode('work')
    expect(work.matches(sessionsState)).toBe(true)
    expect(work.matches(sourcesState)).toBe(true)
    expect(work.matches(settingsState)).toBe(true)
    expect(work.matches(skillsState)).toBe(true)
    expect(work.matches(automationsState)).toBe(true)
  })

  it('work mode does not match canvas, gamestudio, or design navigation', () => {
    const work = getAppMode('work')
    expect(work.matches(canvasState)).toBe(false)
    expect(work.matches(canvasDocState)).toBe(false)
    expect(work.matches(gamestudioState)).toBe(false)
    expect(work.matches(gamestudioProjectState)).toBe(false)
    expect(work.matches(designState)).toBe(false)
    expect(work.matches(designProjectState)).toBe(false)
  })

  it('canvas mode matches only canvas navigation', () => {
    const canvas = getAppMode('canvas')
    expect(canvas.matches(canvasState)).toBe(true)
    expect(canvas.matches(canvasDocState)).toBe(true)
    expect(canvas.matches(sessionsState)).toBe(false)
    expect(canvas.matches(automationsState)).toBe(false)
    expect(canvas.matches(gamestudioState)).toBe(false)
    expect(canvas.matches(designState)).toBe(false)
  })

  it('gamestudio mode matches only gamestudio navigation', () => {
    const gamestudio = getAppMode('gamestudio')
    expect(gamestudio.matches(gamestudioState)).toBe(true)
    expect(gamestudio.matches(gamestudioProjectState)).toBe(true)
    expect(isGameStudioNavigation(gamestudioState)).toBe(true)
    expect(gamestudio.matches(canvasState)).toBe(false)
    expect(gamestudio.matches(sessionsState)).toBe(false)
    expect(gamestudio.matches(designState)).toBe(false)
  })

  it('design mode matches only design navigation', () => {
    const design = getAppMode('design')
    expect(design.matches(designState)).toBe(true)
    expect(design.matches(designProjectState)).toBe(true)
    expect(isDesignNavigation(designState)).toBe(true)
    expect(design.matches(gamestudioState)).toBe(false)
    expect(design.matches(canvasState)).toBe(false)
    expect(design.matches(sessionsState)).toBe(false)
  })

  it('defaultRoute returns navigable view routes', () => {
    expect(getAppMode('work').defaultRoute()).toBe('allSessions')
    expect(getAppMode('canvas').defaultRoute()).toBe('canvas')
    expect(getAppMode('gamestudio').defaultRoute()).toBe('gamestudio')
    expect(getAppMode('design').defaultRoute()).toBe('design')
  })

  it('getAppModeForNavigation derives the mode from navigation state', () => {
    expect(getAppModeForNavigation(sessionsState).id).toBe('work')
    expect(getAppModeForNavigation(settingsState).id).toBe('work')
    expect(getAppModeForNavigation(canvasState).id).toBe('canvas')
    expect(getAppModeForNavigation(canvasDocState).id).toBe('canvas')
    expect(getAppModeForNavigation(gamestudioState).id).toBe('gamestudio')
    expect(getAppModeForNavigation(gamestudioProjectState).id).toBe('gamestudio')
    expect(getAppModeForNavigation(designState).id).toBe('design')
    expect(getAppModeForNavigation(designProjectState).id).toBe('design')
  })

  it('every mode declares a labelKey and iconId for the renderer', () => {
    for (const mode of APP_MODES) {
      expect(mode.labelKey.length).toBeGreaterThan(0)
      expect(mode.iconId.length).toBeGreaterThan(0)
    }
  })
})
