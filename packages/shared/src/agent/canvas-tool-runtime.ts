/**
 * Canvas Tool Runtime
 *
 * Backend-agnostic dispatch + result formatting for the canvas_* tools. Both
 * the Claude adapter (createCanvasTools) and the Pi adapter (executeSessionTool)
 * route through this so the two backends stay behaviourally identical.
 *
 * Validation of tool arguments and typed error handling live here; the actual
 * mutations happen in the injected CanvasToolFns (wired by the server-core
 * SessionManager to the canvas storage service).
 */

import type {
  CanvasToolFns,
  CanvasCreateNodeParams,
  CanvasUpdateNodeParams,
  CanvasConnectParams,
  CanvasGenerateImageParams,
} from './canvas-tools.ts';

export interface CanvasToolCommandResult {
  output: string;
  isError: boolean;
}

function ok(output: string): CanvasToolCommandResult {
  return { output, isError: false };
}

function err(message: string): CanvasToolCommandResult {
  return { output: `Error: ${message}`, isError: true };
}

export async function executeCanvasToolCommand(params: {
  toolName: string;
  args: Record<string, unknown>;
  fns: CanvasToolFns;
}): Promise<CanvasToolCommandResult> {
  const { toolName, args, fns } = params;
  try {
    switch (toolName) {
      case 'canvas_list_nodes': {
        const result = await fns.listNodes();
        return ok(JSON.stringify(result, null, 2));
      }
      case 'canvas_create_node': {
        const create = args as unknown as CanvasCreateNodeParams;
        if (create.type !== 'image' && create.type !== 'text') {
          return err("'type' must be 'image' or 'text'");
        }
        if (create.type === 'text' && (create.text === undefined || create.text === null)) {
          return err("type='text' requires a 'text' value");
        }
        if (create.type === 'image' && !create.imagePath) {
          return err("type='image' requires an 'imagePath' value");
        }
        const result = await fns.createNode(create);
        return ok(`Created ${result.type} node ${result.nodeId}`);
      }
      case 'canvas_update_node': {
        const update = args as unknown as CanvasUpdateNodeParams;
        if (!update.nodeId) return err("'nodeId' is required");
        const result = await fns.updateNode(update);
        return ok(`Updated node ${result.nodeId}`);
      }
      case 'canvas_connect': {
        const connect = args as unknown as CanvasConnectParams;
        if (!connect.source || !connect.target) return err("'source' and 'target' are required");
        const result = await fns.connect(connect);
        return ok(`Connected ${connect.source} -> ${connect.target} (edge ${result.edgeId})`);
      }
      case 'canvas_generate_image': {
        const gen = args as unknown as CanvasGenerateImageParams;
        if (!gen.prompt || !String(gen.prompt).trim()) return err("'prompt' is required");
        const result = await fns.generateImage(gen);
        return ok(`Generated image ${result.imageFileName} into node ${result.nodeId}`);
      }
      default:
        return err(`Unknown canvas tool: ${toolName}`);
    }
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}
