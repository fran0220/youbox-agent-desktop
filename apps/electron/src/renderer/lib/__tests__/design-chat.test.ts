import { describe, expect, it } from 'bun:test'
import {
  buildDesignSessionCreateOptions,
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
})
