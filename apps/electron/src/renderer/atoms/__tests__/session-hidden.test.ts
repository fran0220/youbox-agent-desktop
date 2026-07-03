import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { Session } from '@craft-agent/shared/protocol'
import {
  addSessionAtom,
  loadedSessionsAtom,
  replaceLoadedSessionAtom,
  sessionIdsAtom,
  sessionMetaMapAtom,
  updateSessionAtom,
} from '../sessions'

function session(id: string, hidden = false): Session {
  return {
    id,
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace',
    lastMessageAt: 1,
    messages: [],
    isProcessing: false,
    hidden,
  }
}

describe('hidden renderer sessions', () => {
  it('keeps hidden sessions out of metadata lists and counts when added or loaded', () => {
    const store = createStore()

    store.set(addSessionAtom, session('visible'))
    store.set(addSessionAtom, session('hidden', true))

    expect(store.get(sessionIdsAtom)).toEqual(['visible'])
    expect([...store.get(sessionMetaMapAtom).keys()]).toEqual(['visible'])
    expect(store.get(loadedSessionsAtom).has('hidden')).toBe(true)

    store.set(replaceLoadedSessionAtom, session('hidden', true))
    expect(store.get(sessionIdsAtom)).toEqual(['visible'])
    expect(store.get(sessionMetaMapAtom).has('hidden')).toBe(false)
  })

  it('removes a session from metadata if an update marks it hidden', () => {
    const store = createStore()
    store.set(addSessionAtom, session('session-a'))

    store.set(updateSessionAtom, 'session-a', (prev) => prev ? { ...prev, hidden: true } : prev)

    expect(store.get(sessionIdsAtom)).toEqual([])
    expect(store.get(sessionMetaMapAtom).has('session-a')).toBe(false)
  })
})
