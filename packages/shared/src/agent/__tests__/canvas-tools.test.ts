/**
 * Tests for the canvas tools factory + session-scoped registration gating.
 *
 * Verifies that createCanvasTools produces the five canvas_* tools, that they
 * delegate to CanvasToolFns callbacks, surface typed errors, and that the tools
 * are ONLY exposed to a session when canvasFns are registered (bound session).
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { createCanvasTools, CANVAS_TOOL_NAMES, type CanvasToolFns } from '../canvas-tools.ts'
import {
  registerSessionScopedToolCallbacks,
  mergeSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
  getSessionScopedToolCallbacks,
} from '../session-scoped-tools.ts'
import { SESSION_BACKEND_TOOL_NAMES } from '@craft-agent/session-tools-core'

function createMockFns(overrides: Partial<CanvasToolFns> = {}): CanvasToolFns {
  return {
    listNodes: async () => ({
      docId: 'doc-1',
      docName: 'My Canvas',
      nodes: [{ id: 'n1', type: 'text', position: { x: 0, y: 0 }, text: 'hi' }],
      edges: [],
    }),
    createNode: async () => ({ nodeId: 'new-node', type: 'text' as const }),
    updateNode: async () => ({ nodeId: 'n1' }),
    connect: async () => ({ edgeId: 'edge-1' }),
    generateImage: async () => ({ nodeId: 'img-node', imageFileName: 'gen.png' }),
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findTool(tools: ReturnType<typeof createCanvasTools>, name: string) {
  return tools.find((t: any) => t.name === name)
}

async function executeTool(
  tools: ReturnType<typeof createCanvasTools>,
  name: string,
  args: Record<string, unknown> = {},
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = findTool(tools, name) as any
  if (!t) throw new Error(`Tool "${name}" not found`)
  return t.handler(args)
}

describe('createCanvasTools', () => {
  let mockFns: CanvasToolFns
  let tools: ReturnType<typeof createCanvasTools>

  beforeEach(() => {
    mockFns = createMockFns()
    tools = createCanvasTools({ sessionId: 'test-session', getCanvasFns: () => mockFns })
  })

  it('exposes exactly the five canvas tools', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names = tools.map((t: any) => t.name)
    expect(names).toEqual([...CANVAS_TOOL_NAMES])
  })

  it('canvas_list_nodes returns the doc summary JSON', async () => {
    const result = await executeTool(tools, 'canvas_list_nodes')
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.docId).toBe('doc-1')
    expect(parsed.nodes).toHaveLength(1)
  })

  it('canvas_create_node (text) delegates and reports the new node id', async () => {
    let received: unknown
    mockFns.createNode = async (params) => {
      received = params
      return { nodeId: 'created-1', type: 'text' }
    }
    const result = await executeTool(tools, 'canvas_create_node', { type: 'text', text: 'hello' })
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('created-1')
    expect(received).toEqual({ type: 'text', text: 'hello' })
  })

  it('canvas_create_node validates: text requires text', async () => {
    const result = await executeTool(tools, 'canvas_create_node', { type: 'text' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("requires a 'text'")
  })

  it('canvas_create_node validates: image requires imagePath', async () => {
    const result = await executeTool(tools, 'canvas_create_node', { type: 'image' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("requires an 'imagePath'")
  })

  it('canvas_update_node delegates', async () => {
    const result = await executeTool(tools, 'canvas_update_node', { nodeId: 'n1', x: 10 })
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('n1')
  })

  it('canvas_connect delegates', async () => {
    const result = await executeTool(tools, 'canvas_connect', { source: 'a', target: 'b' })
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('edge-1')
  })

  it('canvas_generate_image delegates', async () => {
    const result = await executeTool(tools, 'canvas_generate_image', { prompt: 'a cat' })
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('gen.png')
  })

  it('surfaces callback errors as tool errors (unknown node)', async () => {
    mockFns.updateNode = async () => {
      throw new Error('Canvas node not found: ghost')
    }
    const result = await executeTool(tools, 'canvas_update_node', { nodeId: 'ghost' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Canvas node not found: ghost')
  })

  it('errors when no canvasFns are available (unbound session)', async () => {
    const unbound = createCanvasTools({ sessionId: 's', getCanvasFns: () => undefined })
    const result = await executeTool(unbound, 'canvas_list_nodes')
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not bound to a canvas document')
  })
})

describe('canvas tools registry parity', () => {
  it('all canvas tool names are backend-executed session tools', () => {
    for (const name of CANVAS_TOOL_NAMES) {
      expect(SESSION_BACKEND_TOOL_NAMES.has(name)).toBe(true)
    }
  })
})

describe('session-scoped canvas registration gating', () => {
  const boundSession = 'canvas-bound-session'
  const unboundSession = 'plain-session'

  beforeEach(() => {
    unregisterSessionScopedToolCallbacks(boundSession)
    unregisterSessionScopedToolCallbacks(unboundSession)
  })

  it('canvasFns are present only for sessions that registered them', () => {
    registerSessionScopedToolCallbacks(unboundSession, {})
    registerSessionScopedToolCallbacks(boundSession, {})
    mergeSessionScopedToolCallbacks(boundSession, { canvasFns: createMockFns() })

    expect(getSessionScopedToolCallbacks(unboundSession)?.canvasFns).toBeUndefined()
    expect(getSessionScopedToolCallbacks(boundSession)?.canvasFns).toBeDefined()
  })

  it('clearing canvasFns (unbind) removes them from the session', () => {
    registerSessionScopedToolCallbacks(boundSession, {})
    mergeSessionScopedToolCallbacks(boundSession, { canvasFns: createMockFns() })
    expect(getSessionScopedToolCallbacks(boundSession)?.canvasFns).toBeDefined()

    mergeSessionScopedToolCallbacks(boundSession, { canvasFns: undefined })
    expect(getSessionScopedToolCallbacks(boundSession)?.canvasFns).toBeUndefined()
  })
})
