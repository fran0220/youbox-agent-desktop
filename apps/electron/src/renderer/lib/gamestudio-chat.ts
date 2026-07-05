import type { Message } from '@craft-agent/core/types'
import type { CreateSessionOptions } from '@craft-agent/shared/protocol'

export interface GameStudioChatMessage {
  role: 'user' | 'assistant'
  text: string
}

const GAME_TOOL_PATH_KEYS = new Set(['file_path', 'filePath', 'path'])

export function resolveGameProjectDir(workspaceRootPath: string, projectId: string): string {
  const root = workspaceRootPath.replace(/[\\/]+$/, '')
  return `${root}/gamestudio/${projectId}`
}

export function buildGameStudioSessionCreateOptions(projectDir: string): CreateSessionOptions {
  return {
    hidden: true,
    workingDirectory: projectDir,
    systemPromptPreset: 'gamestudio',
  }
}

export function sessionMessagesToGameStudioChatMessages(messages: readonly Message[]): GameStudioChatMessage[] {
  return messages.flatMap((message): GameStudioChatMessage[] => {
    if (message.role === 'user') return [{ role: 'user', text: message.content }]
    if (message.role === 'assistant' || message.role === 'plan') {
      if (message.isIntermediate) return []
      return [{ role: 'assistant', text: message.content }]
    }
    if (message.role === 'error') return [{ role: 'assistant', text: message.content }]
    return []
  })
}

export function gameToolInputTouchesProject(toolInput: unknown, projectDir: string | null): boolean {
  if (!projectDir) return false
  const projectRoot = normalizePath(projectDir)
  if (!projectRoot) return false
  return extractGameToolPaths(toolInput).some((inputPath) => {
    const resolvedPath = resolveInputPath(projectRoot, inputPath)
    return Boolean(resolvedPath && isPathInsideDirectory(resolvedPath, projectRoot))
  })
}

export function extractGameToolPaths(toolInput: unknown): string[] {
  const paths: string[] = []
  const visit = (value: unknown, key?: string) => {
    if (typeof value === 'string') {
      if (key && GAME_TOOL_PATH_KEYS.has(key) && value.trim()) paths.push(value)
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item))
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [entryKey, entryValue] of Object.entries(value)) {
      visit(entryValue, entryKey)
    }
  }
  visit(toolInput)
  return paths
}

export interface GamePreviewRefreshScheduler {
  schedule: () => void
  cancel: () => void
}

export function createGamePreviewRefreshScheduler({
  delayMs,
  refresh,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: {
  delayMs: number
  refresh: () => void
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}): GamePreviewRefreshScheduler {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  return {
    schedule: () => {
      if (pendingTimer !== null) clearTimer(pendingTimer)
      pendingTimer = setTimer(() => {
        pendingTimer = null
        refresh()
      }, delayMs)
    },
    cancel: () => {
      if (pendingTimer === null) return
      clearTimer(pendingTimer)
      pendingTimer = null
    },
  }
}

function resolveInputPath(projectRoot: string, inputPath: string): string | null {
  const trimmed = inputPath.trim()
  if (!trimmed || trimmed.startsWith('~/') || trimmed === '~') return null
  if (isAbsolutePath(trimmed)) return normalizePath(trimmed)
  return normalizePath(`${projectRoot}/${trimmed}`)
}

function isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
  const candidate = normalizePath(candidatePath)
  const directory = normalizePath(directoryPath)
  return candidate === directory || candidate.startsWith(`${directory}/`)
}

function normalizePath(inputPath: string): string {
  const slashed = inputPath.replace(/\\/g, '/')
  const root = getPathRoot(slashed)
  const parts = slashed.slice(root.length).split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(part)
  }
  const normalized = `${root}${stack.join('/')}`
  if (normalized.length > root.length) return normalized.replace(/\/+$/, '')
  return root || '.'
}

function getPathRoot(inputPath: string): string {
  const drive = inputPath.match(/^[A-Za-z]:\//)
  if (drive) return drive[0]
  return inputPath.startsWith('/') ? '/' : ''
}

function isAbsolutePath(inputPath: string): boolean {
  return inputPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(inputPath)
}
