/**
 * Canvas Tools (`canvas_*`)
 *
 * Session-scoped tooling that lets the agent read and mutate the canvas
 * document bound to the current session. Mirrors the browser_tool /
 * BrowserPaneFns pattern: the tool wrappers here are backend-agnostic and
 * delegate to CanvasToolFns callbacks wired by the Electron SessionManager to
 * the server-core canvas storage service (which broadcasts canvas:changed so
 * the UI updates live).
 *
 * These tools are ONLY registered for sessions that drive a canvas doc
 * (session id === some doc's chatSessionId). Sessions with no bound doc never
 * receive a CanvasToolFns instance, so the tools are simply absent.
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import {
  CanvasListNodesSchema,
  CanvasCreateNodeSchema,
  CanvasUpdateNodeSchema,
  CanvasConnectSchema,
  CanvasGenerateImageSchema,
  TOOL_DESCRIPTIONS,
} from '@craft-agent/session-tools-core';
import { executeCanvasToolCommand } from './canvas-tool-runtime.ts';

// ============================================================================
// Canvas Tool Function Interface (parallel to BrowserPaneFns)
// ============================================================================

export interface CanvasNodeSummary {
  id: string;
  type: 'image' | 'text';
  position: { x: number; y: number };
  /** Present for text nodes */
  text?: string;
  /** Present for image nodes */
  fileName?: string;
  width?: number;
  height?: number;
}

export interface CanvasEdgeSummary {
  id: string;
  source: string;
  target: string;
}

export interface CanvasListResult {
  docId: string;
  docName: string;
  nodes: CanvasNodeSummary[];
  edges: CanvasEdgeSummary[];
}

export interface CanvasCreateNodeParams {
  type: 'image' | 'text';
  text?: string;
  imagePath?: string;
  x?: number;
  y?: number;
}

export interface CanvasUpdateNodeParams {
  nodeId: string;
  x?: number;
  y?: number;
  text?: string;
  width?: number;
  height?: number;
}

export interface CanvasConnectParams {
  source: string;
  target: string;
}

export interface CanvasGenerateImageParams {
  prompt: string;
  referenceNodeIds?: string[];
  size?: string;
  nodeId?: string;
}

/**
 * Abstraction over the server-core canvas storage service for use in
 * session-scoped tools. The Electron session manager creates this by binding to
 * the canvas doc that the session drives (via CanvasDocMeta.chatSessionId) and
 * routes every mutation through the same storage + canvas:changed broadcast the
 * RPC handlers use.
 */
export interface CanvasToolFns {
  listNodes: () => Promise<CanvasListResult>;
  createNode: (params: CanvasCreateNodeParams) => Promise<{ nodeId: string; type: 'image' | 'text' }>;
  updateNode: (params: CanvasUpdateNodeParams) => Promise<{ nodeId: string }>;
  connect: (params: CanvasConnectParams) => Promise<{ edgeId: string }>;
  generateImage: (params: CanvasGenerateImageParams) => Promise<{ nodeId: string; imageFileName: string }>;
}

// ============================================================================
// Tool Factory
// ============================================================================

export interface CanvasToolsOptions {
  sessionId: string;
  /** Lazy resolver — read the current CanvasToolFns from the session registry at execution time. */
  getCanvasFns: () => CanvasToolFns | undefined;
}

/** Canvas tool names exposed to the model (backend-executed). */
export const CANVAS_TOOL_NAMES = [
  'canvas_list_nodes',
  'canvas_create_node',
  'canvas_update_node',
  'canvas_connect',
  'canvas_generate_image',
] as const;

const CANVAS_UNAVAILABLE = 'Canvas tools are not available. This session is not bound to a canvas document.';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function createCanvasTools(options: CanvasToolsOptions) {
  function getFns(): CanvasToolFns {
    const fns = options.getCanvasFns();
    if (!fns) throw new Error(CANVAS_UNAVAILABLE);
    return fns;
  }

  function canvasTool(name: string, description: string, schema: any, readOnly = false) {
    return tool(
      name,
      description,
      schema,
      async (args: Record<string, unknown>) => {
        let fns: CanvasToolFns;
        try {
          fns = getFns();
        } catch (error) {
          return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
        }
        const result = await executeCanvasToolCommand({ toolName: name, args, fns });
        return {
          content: [{ type: 'text' as const, text: result.output }],
          ...(result.isError ? { isError: true } : {}),
        };
      },
      readOnly ? { annotations: { readOnlyHint: true } } : undefined,
    );
  }

  return [
    canvasTool('canvas_list_nodes', TOOL_DESCRIPTIONS.canvas_list_nodes, CanvasListNodesSchema.shape, true),
    canvasTool('canvas_create_node', TOOL_DESCRIPTIONS.canvas_create_node, CanvasCreateNodeSchema.shape),
    canvasTool('canvas_update_node', TOOL_DESCRIPTIONS.canvas_update_node, CanvasUpdateNodeSchema.shape),
    canvasTool('canvas_connect', TOOL_DESCRIPTIONS.canvas_connect, CanvasConnectSchema.shape),
    canvasTool('canvas_generate_image', TOOL_DESCRIPTIONS.canvas_generate_image, CanvasGenerateImageSchema.shape),
  ];
}
/* eslint-enable @typescript-eslint/no-explicit-any */
