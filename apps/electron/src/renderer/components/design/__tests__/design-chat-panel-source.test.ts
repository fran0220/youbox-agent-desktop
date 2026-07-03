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

    expect(src).toContain("designProjectUpdate(workspaceId, projectId, { sessionId: session.id })")
    expect(src).toContain('disabled={!input.trim() || streaming || !projectDir}')
    expect(src).toContain('sessionMessagesToDesignChatMessages(session.messages)')
  })
})
