import type { CreateSessionOptions } from '@craft-agent/shared/protocol'
import type { Message } from '@craft-agent/core/types'

export interface DesignChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export function resolveDesignProjectDir(workspaceRootPath: string, projectId: string): string {
  const root = workspaceRootPath.replace(/[\\/]+$/, '')
  return `${root}/design/${projectId}`
}

export function buildDesignSessionCreateOptions(projectDir: string): CreateSessionOptions {
  return {
    hidden: true,
    workingDirectory: projectDir,
    systemPromptPreset: 'design',
  }
}

export function sessionMessagesToDesignChatMessages(messages: readonly Message[]): DesignChatMessage[] {
  return messages.flatMap((message): DesignChatMessage[] => {
    if (message.role === 'user') return [{ role: 'user', text: message.content }]
    if (message.role === 'assistant' || message.role === 'plan') {
      if (message.isIntermediate) return []
      return [{ role: 'assistant', text: message.content }]
    }
    if (message.role === 'error') return [{ role: 'assistant', text: message.content }]
    return []
  })
}
