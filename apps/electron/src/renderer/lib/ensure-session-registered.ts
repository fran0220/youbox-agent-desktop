import { getDefaultStore } from 'jotai'
import {
  replaceLoadedSessionAtom,
  sessionMetaMapAtom,
} from '@/atoms/sessions'
import type { Session } from '../../shared/types'

const DEFAULT_TIMEOUT_MS = 5_000
const POLL_INTERVAL_MS = 50

/**
 * Ensure a session exists in renderer metadata before navigating to it.
 *
 * continueFromImportedSession (and session_created handling) can race with
 * navigation: resolveAutoSelection strips unknown session IDs from routes,
 * which leaves the user on the imported read-only view until they click the
 * new session in the sidebar manually.
 */
export async function ensureSessionRegisteredInRenderer(
  sessionId: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const store = getDefaultStore()
  const deadline = Date.now() + timeoutMs

  const hasMeta = () => store.get(sessionMetaMapAtom).has(sessionId)

  if (hasMeta()) return

  while (Date.now() < deadline) {
    try {
      const loaded = await window.electronAPI.getSessionMessages(sessionId)
      if (loaded) {
        store.set(replaceLoadedSessionAtom, loaded as Session)
        if (hasMeta()) return
      }
    } catch {
      // Session may not be readable yet; keep polling until timeout.
    }

    if (hasMeta()) return
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }

  throw new Error(`Timed out waiting for session ${sessionId} to register in the UI`)
}
