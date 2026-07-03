/**
 * CanvasChatPanel — selection-bound chat for the canvas.
 *
 * Revealed as a right-side panel whenever one or more nodes are selected. It
 * lazily creates a hidden session per canvas doc and persists the session id
 * into the doc's metadata (canvasUpdate({ chatSessionId })) so it is reused
 * across restarts and cleaned up on doc delete. On entry it prefers the doc's
 * persisted session (seeded into a renderer cache atom) and reuses it when the
 * session still exists, otherwise creates a fresh one and re-persists. Each
 * user message is prefixed with a serialized snapshot of the
 * currently selected nodes (text + image references) so the assistant answers
 * about the selection. Streamed assistant text is accumulated directly from the
 * session event stream (onSessionEvent) — a deliberately minimal reader rather
 * than the full ChatDisplay.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Loader2, X } from 'lucide-react'
import type { SessionEvent } from '@craft-agent/shared/protocol'
import {
  canvasChatSessionIdsAtom,
  canvasNodesAtom,
  selectedCanvasNodeIdsAtom,
} from '@/atoms/canvas'
import { serializeSelectionContext } from '@/lib/canvas-generation'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export function CanvasChatPanel({
  workspaceId,
  docId,
  onClose,
}: {
  workspaceId: string
  docId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const nodes = useAtomValue(canvasNodesAtom)
  const selectedIds = useAtomValue(selectedCanvasNodeIdsAtom)
  const [sessionIds, setSessionIds] = useAtom(canvasChatSessionIdsAtom)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const sessionIdRef = useRef<string | null>(sessionIds[docId] ?? null)
  // Session id whose existence has been confirmed this mount, so reuse doesn't
  // re-check on every send.
  const verifiedSessionIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionIdRef.current = sessionIds[docId] ?? null
  }, [sessionIds, docId])

  const selectedNodes = useMemo(
    () => nodes.filter((n) => selectedIds.includes(n.id)),
    [nodes, selectedIds],
  )

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming])

  // Accumulate streamed assistant text for our bound session only.
  useEffect(() => {
    const cleanup = window.electronAPI.onSessionEvent((event: SessionEvent) => {
      if (event.sessionId !== sessionIdRef.current) return
      if (event.type === 'text_delta') {
        setMessages((prev) => appendAssistantDelta(prev, event.delta))
      } else if (event.type === 'text_complete') {
        if (!event.isIntermediate) {
          setMessages((prev) => replaceAssistantText(prev, event.text))
        }
      } else if (event.type === 'complete') {
        setStreaming(false)
      } else if (event.type === 'error') {
        setMessages((prev) => replaceAssistantText(prev, event.error))
        setStreaming(false)
      } else if (event.type === 'typed_error') {
        setMessages((prev) => replaceAssistantText(prev, event.error.message))
        setStreaming(false)
      }
    })
    return cleanup
  }, [])

  const ensureSession = useCallback(async (): Promise<string> => {
    const existing = sessionIdRef.current
    if (existing) {
      if (verifiedSessionIdRef.current === existing) return existing
      // Prefer the persisted/cached session, but only if it still exists — it
      // may have been deleted (e.g. via delete-doc cleanup) between mounts.
      const loaded = await window.electronAPI.getSessionMessages(existing)
      if (loaded) {
        verifiedSessionIdRef.current = existing
        return existing
      }
    }
    const session = await window.electronAPI.createSession(workspaceId, {
      hidden: true,
      name: t('canvas.chat.title'),
    })
    sessionIdRef.current = session.id
    verifiedSessionIdRef.current = session.id
    setSessionIds((prev) => ({ ...prev, [docId]: session.id }))
    // Persist into doc metadata (source of truth) — best-effort so a failed
    // bind never blocks the chat. The session is still usable this mount.
    try {
      await window.electronAPI.canvasUpdate(workspaceId, docId, { chatSessionId: session.id })
    } catch (err) {
      console.error('[Canvas] Failed to persist chat session id:', err)
    }
    return session.id
  }, [workspaceId, docId, t, setSessionIds])

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || streaming) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }, { role: 'assistant', text: '' }])
    setStreaming(true)
    try {
      const sessionId = await ensureSession()
      const context = serializeSelectionContext(selectedNodes)
      const message = context ? `[Canvas selection]\n${context}\n\n${trimmed}` : trimmed
      await window.electronAPI.sendMessage(sessionId, message)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessages((prev) => replaceAssistantText(prev, msg))
      setStreaming(false)
    }
  }, [input, streaming, ensureSession, selectedNodes])

  return (
    <div className="absolute right-3 top-3 bottom-3 z-10 flex w-80 flex-col overflow-hidden rounded-lg bg-background shadow-minimal">
      <div className="flex items-center justify-between border-b border-foreground/10 px-3 py-2">
        <div className="flex flex-col">
          <span className="text-xs font-medium text-foreground">{t('canvas.chat.title')}</span>
          <span className="text-[10px] text-muted-foreground">
            {t('canvas.chat.contextLabel', { count: selectedIds.length })}
          </span>
        </div>
        <button
          type="button"
          aria-label={t('canvas.chat.close')}
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-[5px] text-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('canvas.chat.empty')}</p>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {msg.role === 'user' ? t('canvas.chat.you') : t('canvas.chat.assistant')}
              </span>
              {msg.text ? (
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                  {msg.text}
                </p>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                  {t('canvas.chat.thinking')}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-foreground/10 p-2">
        <textarea
          value={input}
          rows={2}
          placeholder={t('canvas.chat.placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
          className="block w-full resize-none rounded-[6px] bg-foreground/5 p-2 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-1.5 flex justify-end">
          <button
            type="button"
            disabled={!input.trim() || streaming}
            onClick={() => void handleSend()}
            className="rounded-[6px] bg-accent px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t('canvas.chat.send')}
          </button>
        </div>
      </div>
    </div>
  )
}

function appendAssistantDelta(messages: ChatMessage[], delta: string): ChatMessage[] {
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant') {
    return [...messages.slice(0, -1), { ...last, text: last.text + delta }]
  }
  return [...messages, { role: 'assistant', text: delta }]
}

function replaceAssistantText(messages: ChatMessage[], text: string): ChatMessage[] {
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant') {
    return [...messages.slice(0, -1), { ...last, text }]
  }
  return [...messages, { role: 'assistant', text }]
}
