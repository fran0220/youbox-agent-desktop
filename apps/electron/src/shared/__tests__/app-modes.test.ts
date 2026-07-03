import { describe, it, expect } from 'bun:test'
import { APP_MODES, DEFAULT_APP_MODE_ID, getAppMode, getAppModeForNavigation } from '../app-modes'
import type { NavigationState } from '../types'

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

describe('app-modes registry', () => {
  it('exposes work and canvas modes in order', () => {
    expect(APP_MODES.map((m) => m.id)).toEqual(['work', 'canvas'])
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

  it('work mode does not match canvas navigation', () => {
    const work = getAppMode('work')
    expect(work.matches(canvasState)).toBe(false)
    expect(work.matches(canvasDocState)).toBe(false)
  })

  it('canvas mode matches only canvas navigation', () => {
    const canvas = getAppMode('canvas')
    expect(canvas.matches(canvasState)).toBe(true)
    expect(canvas.matches(canvasDocState)).toBe(true)
    expect(canvas.matches(sessionsState)).toBe(false)
    expect(canvas.matches(automationsState)).toBe(false)
  })

  it('defaultRoute returns navigable view routes', () => {
    expect(getAppMode('work').defaultRoute()).toBe('allSessions')
    expect(getAppMode('canvas').defaultRoute()).toBe('canvas')
  })

  it('getAppModeForNavigation derives the mode from navigation state', () => {
    expect(getAppModeForNavigation(sessionsState).id).toBe('work')
    expect(getAppModeForNavigation(settingsState).id).toBe('work')
    expect(getAppModeForNavigation(canvasState).id).toBe('canvas')
    expect(getAppModeForNavigation(canvasDocState).id).toBe('canvas')
  })

  it('every mode declares a labelKey and iconId for the renderer', () => {
    for (const mode of APP_MODES) {
      expect(mode.labelKey.length).toBeGreaterThan(0)
      expect(mode.iconId.length).toBeGreaterThan(0)
    }
  })
})
