import { describe, it, expect } from 'bun:test'
import { isSessionStreamSuccessTerminal, isSessionStreamTerminal } from './session-stream.ts'

describe('session stream terminal events', () => {
  it('treats text_complete and usage_update as success terminal', () => {
    expect(isSessionStreamSuccessTerminal({ type: 'text_complete' })).toBe(true)
    expect(isSessionStreamSuccessTerminal({ type: 'usage_update' })).toBe(true)
    expect(isSessionStreamSuccessTerminal({ type: 'complete' })).toBe(true)
    expect(isSessionStreamSuccessTerminal({ type: 'text_delta' })).toBe(false)
  })

  it('treats error and interrupted as terminal', () => {
    expect(isSessionStreamTerminal({ type: 'error' })).toBe(true)
    expect(isSessionStreamTerminal({ type: 'interrupted' })).toBe(true)
    expect(isSessionStreamTerminal({ type: 'usage_update' })).toBe(true)
    expect(isSessionStreamTerminal({ type: 'text_delta' })).toBe(false)
  })
})
