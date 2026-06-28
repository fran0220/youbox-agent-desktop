import { afterEach, describe, expect, it } from 'bun:test'
import { getDefaultStore } from 'jotai'
import {
  initializeSessionsAtom,
  sessionMetaMapAtom,
} from '@/atoms/sessions'
import type { Session } from '../../../shared/types'
import { ensureSessionRegisteredInRenderer } from '../ensure-session-registered'

function makeSession(id: string): Session {
  return {
    id,
    workspaceId: 'ws-1',
    workspaceName: 'test',
    messages: [],
    isProcessing: false,
    lastMessageAt: Date.now(),
    permissionMode: 'ask',
    supportsBranching: true,
  } as Session
}

describe('ensureSessionRegisteredInRenderer', () => {
  const originalWindow = globalThis.window
  let fetchCount = 0

  afterEach(() => {
    fetchCount = 0
    if (originalWindow) {
      globalThis.window = originalWindow
    } else {
      // @ts-expect-error test cleanup for window shim
      delete globalThis.window
    }
  })

  it('returns immediately when session meta already exists', async () => {
    const store = getDefaultStore()
    store.set(initializeSessionsAtom, [makeSession('existing')])

    globalThis.window = {
      electronAPI: {
        getSessionMessages: async () => {
          fetchCount += 1
          return null
        },
      },
    } as unknown as Window & typeof globalThis

    await ensureSessionRegisteredInRenderer('existing', { timeoutMs: 500 })

    expect(fetchCount).toBe(0)
    expect(store.get(sessionMetaMapAtom).has('existing')).toBe(true)
  })

  it('loads session via getSessionMessages when meta is missing', async () => {
    const store = getDefaultStore()
    store.set(initializeSessionsAtom, [])
    const session = makeSession('continued-1')

    globalThis.window = {
      electronAPI: {
        getSessionMessages: async (id: string) => {
          fetchCount += 1
          return id === 'continued-1' ? session : null
        },
      },
    } as unknown as Window & typeof globalThis

    await ensureSessionRegisteredInRenderer('continued-1', { timeoutMs: 2000 })

    expect(fetchCount).toBeGreaterThan(0)
    expect(store.get(sessionMetaMapAtom).has('continued-1')).toBe(true)
  })
})
