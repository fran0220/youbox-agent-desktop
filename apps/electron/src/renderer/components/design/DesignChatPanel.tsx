import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { SessionEvent } from '@craft-agent/shared/protocol'
import { designChatSessionIdsAtom } from '@/atoms/design'
import {
  buildDesignSessionCreateOptions,
  sessionMessagesToDesignChatMessages,
  type DesignChatMessage,
} from '@/lib/design-chat'

export function DesignChatPanel({
  workspaceId,
  projectId,
  projectDir,
  persistedSessionId,
}: {
  workspaceId: string
  projectId: string
  projectDir: string | null
  persistedSessionId: string | null
}) {
  const { t } = useTranslation()
  const [sessionIds, setSessionIds] = useAtom(designChatSessionIdsAtom)
  const [messages, setMessages] = useState<DesignChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const sessionIdRef = useRef<string | null>(sessionIds[projectId] ?? persistedSessionId ?? null)
  const verifiedSessionIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionIdRef.current = sessionIds[projectId] ?? persistedSessionId ?? null
  }, [sessionIds, persistedSessionId, projectId])

  useEffect(() => {
    verifiedSessionIdRef.current = null
    setMessages([])
    setStreaming(false)
  }, [projectId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming, loadingHistory])

  useEffect(() => {
    const existing = sessionIdRef.current
    if (!existing) return

    let disposed = false
    setLoadingHistory(true)
    window.electronAPI.getSessionMessages(existing)
      .then((session) => {
        if (disposed) return
        if (session) {
          verifiedSessionIdRef.current = existing
          setMessages(sessionMessagesToDesignChatMessages(session.messages))
          setStreaming(session.isProcessing)
        } else {
          sessionIdRef.current = null
          setSessionIds((prev) => {
            const next = { ...prev }
            delete next[projectId]
            return next
          })
        }
      })
      .catch((err) => {
        if (!disposed) {
          console.error('[Design] Failed to load chat history:', err)
        }
      })
      .finally(() => {
        if (!disposed) setLoadingHistory(false)
      })

    return () => {
      disposed = true
    }
  }, [projectId, setSessionIds])

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
      const loaded = await window.electronAPI.getSessionMessages(existing)
      if (loaded) {
        verifiedSessionIdRef.current = existing
        setMessages(sessionMessagesToDesignChatMessages(loaded.messages))
        setStreaming(loaded.isProcessing)
        return existing
      }
    }

    if (!projectDir) throw new Error(t('design.chat.missingProjectDir'))

    const session = await window.electronAPI.createSession(
      workspaceId,
      buildDesignSessionCreateOptions(projectDir),
    )
    sessionIdRef.current = session.id
    verifiedSessionIdRef.current = session.id
    setSessionIds((prev) => ({ ...prev, [projectId]: session.id }))
    try {
      await window.electronAPI.designProjectUpdate(workspaceId, projectId, { sessionId: session.id })
    } catch (err) {
      console.error('[Design] Failed to persist chat session id:', err)
    }
    return session.id
  }, [workspaceId, projectId, projectDir, setSessionIds, t])

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || streaming) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }, { role: 'assistant', text: '' }])
    setStreaming(true)
    try {
      const sessionId = await ensureSession()
      await window.electronAPI.sendMessage(sessionId, trimmed)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessages((prev) => replaceAssistantText(prev, msg))
      setStreaming(false)
    }
  }, [input, streaming, ensureSession])

  return (
    <aside className="flex min-h-0 w-80 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-medium text-foreground">{t('design.chat.title')}</span>
          <span className="truncate text-[10px] text-muted-foreground">{t('design.chat.subtitle')}</span>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {loadingHistory ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
            {t('design.chat.loading')}
          </span>
        ) : messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('design.chat.empty')}</p>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {msg.role === 'user' ? t('design.chat.you') : t('design.chat.assistant')}
              </span>
              {msg.text ? (
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                  {msg.text}
                </p>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                  {t('design.chat.thinking')}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border p-2">
        <textarea
          value={input}
          rows={3}
          placeholder={t('design.chat.placeholder')}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void handleSend()
            }
          }}
          className="block w-full resize-none rounded-[6px] bg-foreground/5 p-2 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-1.5 flex justify-end">
          <button
            type="button"
            disabled={!input.trim() || streaming || !projectDir}
            onClick={() => void handleSend()}
            className="rounded-[6px] bg-accent px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {streaming ? t('design.chat.streaming') : t('design.chat.send')}
          </button>
        </div>
      </div>
    </aside>
  )
}

function appendAssistantDelta(messages: DesignChatMessage[], delta: string): DesignChatMessage[] {
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant') {
    return [...messages.slice(0, -1), { ...last, text: last.text + delta }]
  }
  return [...messages, { role: 'assistant', text: delta }]
}

function replaceAssistantText(messages: DesignChatMessage[], text: string): DesignChatMessage[] {
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant') {
    return [...messages.slice(0, -1), { ...last, text }]
  }
  return [...messages, { role: 'assistant', text }]
}
