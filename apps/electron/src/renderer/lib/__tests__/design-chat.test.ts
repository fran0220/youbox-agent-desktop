import { describe, expect, it } from 'bun:test'
import {
  buildDesignSessionCreateOptions,
  createDesignPreviewRefreshScheduler,
  designToolInputTouchesProject,
  extractDesignToolPaths,
  resolveDesignProjectDir,
  sessionMessagesToDesignChatMessages,
} from '../design-chat'

describe('design chat helpers', () => {
  it('builds the exact hidden design session creation options', () => {
    expect(buildDesignSessionCreateOptions('/tmp/workspace/design/project-a')).toEqual({
      hidden: true,
      workingDirectory: '/tmp/workspace/design/project-a',
      systemPromptPreset: 'design',
    })
  })

  it('resolves the project working directory under the workspace design folder', () => {
    expect(resolveDesignProjectDir('/tmp/workspace/', 'project-a')).toBe('/tmp/workspace/design/project-a')
    expect(resolveDesignProjectDir('/tmp/workspace', 'project-a')).toBe('/tmp/workspace/design/project-a')
  })

  it('maps persisted session history to visible design chat messages', () => {
    expect(sessionMessagesToDesignChatMessages([
      { id: 'u1', role: 'user', content: 'Make a landing page', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'Working...', timestamp: 2, isIntermediate: true },
      { id: 'a2', role: 'assistant', content: 'Done', timestamp: 3 },
      { id: 't1', role: 'tool', content: 'wrote file', timestamp: 4 },
      { id: 'e1', role: 'error', content: 'Failed', timestamp: 5 },
    ])).toEqual([
      { role: 'user', text: 'Make a landing page' },
      { role: 'assistant', text: 'Done' },
      { role: 'assistant', text: 'Failed' },
    ])
  })

  it('extracts file path fields from common write tool inputs', () => {
    expect(extractDesignToolPaths({
      file_path: 'index.html',
      content: '/tmp/not-a-path.html',
      edits: [{ old_string: 'a', new_string: 'b' }],
      nested: { path: 'assets/image.png' },
    })).toEqual(['index.html', 'assets/image.png'])
  })

  it('matches relative and absolute writes that resolve under the project directory', () => {
    const projectDir = '/tmp/workspace/design/project-a'

    expect(designToolInputTouchesProject({ file_path: 'index.html' }, projectDir)).toBe(true)
    expect(designToolInputTouchesProject({ file_path: 'assets/../index.html' }, projectDir)).toBe(true)
    expect(designToolInputTouchesProject({ file_path: '/tmp/workspace/design/project-a/index.html' }, projectDir)).toBe(true)
  })

  it('ignores outside-project, parent traversal, tilde, and content-only inputs', () => {
    const projectDir = '/tmp/workspace/design/project-a'

    expect(designToolInputTouchesProject({ file_path: '/tmp/outside.html' }, projectDir)).toBe(false)
    expect(designToolInputTouchesProject({ file_path: '../project-b/index.html' }, projectDir)).toBe(false)
    expect(designToolInputTouchesProject({ file_path: '~/index.html' }, projectDir)).toBe(false)
    expect(designToolInputTouchesProject({ content: '/tmp/workspace/design/project-a/index.html' }, projectDir)).toBe(false)
  })

  it('debounces preview refreshes to a single trailing callback', () => {
    const callbacks: Array<() => void> = []
    const cleared = new Set<number>()
    let refreshCount = 0
    const scheduler = createDesignPreviewRefreshScheduler({
      delayMs: 400,
      refresh: () => {
        refreshCount += 1
      },
      setTimer: (callback) => {
        callbacks.push(callback)
        return callbacks.length - 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: (timer) => {
        cleared.add(timer as unknown as number)
      },
    })

    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()

    expect(cleared).toEqual(new Set([0, 1]))
    callbacks.forEach((callback, index) => {
      if (!cleared.has(index)) callback()
    })
    expect(refreshCount).toBe(1)
  })

  it('cancels a pending preview refresh', () => {
    const callbacks: Array<() => void> = []
    const cleared = new Set<number>()
    let refreshCount = 0
    const scheduler = createDesignPreviewRefreshScheduler({
      delayMs: 400,
      refresh: () => {
        refreshCount += 1
      },
      setTimer: (callback) => {
        callbacks.push(callback)
        return callbacks.length - 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: (timer) => {
        cleared.add(timer as unknown as number)
      },
    })

    scheduler.schedule()
    scheduler.cancel()
    callbacks.forEach((callback, index) => {
      if (!cleared.has(index)) callback()
    })
    expect(refreshCount).toBe(0)
  })
})
