/**
 * Session stream completion helpers — match the real per-user backend event vocabulary
 * (text_complete + usage_update), not only legacy `complete`.
 */

export type SessionStreamEvent = { type: string; [key: string]: unknown }

/** True when a session:event indicates the assistant turn finished successfully. */
export function isSessionStreamSuccessTerminal(ev: SessionStreamEvent): boolean {
  return ev.type === 'complete' || ev.type === 'text_complete' || ev.type === 'usage_update'
}

/** True when the stream should stop waiting (success, error, or interrupt). */
export function isSessionStreamTerminal(ev: SessionStreamEvent): boolean {
  return (
    isSessionStreamSuccessTerminal(ev) ||
    ev.type === 'error' ||
    ev.type === 'interrupted'
  )
}
