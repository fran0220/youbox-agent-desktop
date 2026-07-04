import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const DESIGN_CHAT_PANEL_PATH = join(import.meta.dir, '..', 'DesignChatPanel.tsx')

describe('design chat panel source wiring', () => {
  it('creates hidden design sessions lazily from the send path', () => {
    const src = readFileSync(DESIGN_CHAT_PANEL_PATH, 'utf8')
    const firstCreateSession = src.indexOf('window.electronAPI.createSession(')
    const handleSend = src.indexOf('const handleSend = useCallback')

    expect(src).toContain('buildDesignSessionCreateOptions(projectDir)')
    expect(firstCreateSession).toBeGreaterThan(src.indexOf('const ensureSession = useCallback'))
    expect(handleSend).toBeGreaterThan(firstCreateSession)
    expect(src).toContain('const sessionId = await ensureSession()')
  })

  it('persists the session id through design:update and disables send while streaming', () => {
    const src = readFileSync(DESIGN_CHAT_PANEL_PATH, 'utf8')

    expect(src).toContain('await window.electronAPI.designProjectUpdate(workspaceId, projectId, { sessionId })')
    expect(src).toContain('disabled={!input.trim() || streaming || !projectDir}')
    expect(src).toContain('sessionMessagesToDesignChatMessages(session.messages)')
  })

  it('blocks send, toasts, and cleans up hidden sessions when persistence fails', () => {
    const src = readFileSync(DESIGN_CHAT_PANEL_PATH, 'utf8')

    expect(src).toContain('persistDesignChatSessionBinding({')
    expect(src).toContain('cleanupSession: (sessionId) => window.electronAPI.deleteSession(sessionId)')
    expect(src).toContain("toast.error(message)")
    expect(src).toContain("t('design.chat.persistSessionError')")
    expect(src).toContain('throw new Error(message)')
  })

  it('correlates tool_start inputs with tool_result events for preview refresh', () => {
    const src = readFileSync(DESIGN_CHAT_PANEL_PATH, 'utf8')

    expect(src).toContain("event.type === 'tool_start'")
    expect(src).toContain('toolInputsRef.current.set(event.toolUseId, event.toolInput)')
    expect(src).toContain("event.type === 'tool_result'")
    expect(src).toContain('designToolInputTouchesProject(toolInput, projectDirRef.current)')
    expect(src).toContain('onProjectFileWriteRef.current?.()')
  })
})
