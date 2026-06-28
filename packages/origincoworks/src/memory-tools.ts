/**
 * In-process MCP tools for the builtin @memory source (read / search / write / delete).
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { GatewayClient } from './gateway-client.ts';
import {
  deleteMemoryFromCache,
  readMemoryFromCache,
  resetMemorySyncStateForTests,
  syncGatewayMemoryToWorkspace,
  writeMemoryToCache,
} from './memory-sync.ts';
import { searchMemory } from './memory-search.ts';
import { normalizeMemoryPath, validateMemoryPath } from './memory-path.ts';

export type MemoryToolDeps = {
  workspaceRoot: string;
  getClient: () => Promise<GatewayClient | null>;
  /** Called before destructive ops; return false to abort. */
  confirmDestructive?: (action: 'delete' | 'clear', detail: string) => Promise<boolean>;
};

const ReadSchema = z.object({
  path: z.string().describe('Memory file path (e.g. MEMORY.md, daily/2026-01-01.md)'),
});

const SearchSchema = z.object({
  query: z.string().describe('Search phrase (pg_trgm on gateway when online; substring offline)'),
  limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
});

const WriteSchema = z.object({
  path: z.string().describe('Memory file path'),
  content: z.string().describe('Full file content to store'),
});

const DeleteSchema = z.object({
  path: z.string().describe('Memory file path to delete'),
});

export function createMemoryMcpServer(deps: MemoryToolDeps): ReturnType<typeof createSdkMcpServer> {
  const readTool = tool(
    'memory_read',
    'Read a gateway-backed memory file by path. Uses local cache when the gateway is unreachable.',
    ReadSchema.shape,
    async (args) => {
      const path = normalizeMemoryPath(args.path);
      if (!validateMemoryPath(path)) {
        return { content: [{ type: 'text' as const, text: `Invalid memory path: ${args.path}` }], isError: true };
      }
      const client = await deps.getClient();
      if (client) {
        try {
          await syncGatewayMemoryToWorkspace({ client, workspaceRoot: deps.workspaceRoot });
        } catch {
          // serve from cache
        }
      }
      const content = readMemoryFromCache(deps.workspaceRoot, path);
      if (content === null) {
        return {
          content: [{ type: 'text' as const, text: `No memory file at path: ${path}` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text' as const, text: content }] };
    },
  );

  const searchTool = tool(
    'memory_search',
    'Search user memory entries (gateway pg_trgm when online; local cache substring when offline).',
    SearchSchema.shape,
    async (args) => {
      const client = await deps.getClient();
      if (client) {
        try {
          await syncGatewayMemoryToWorkspace({ client, workspaceRoot: deps.workspaceRoot });
        } catch {
          // offline search only
        }
      }
      const { hits, offline } = await searchMemory({
        client,
        workspaceRoot: deps.workspaceRoot,
        query: args.query,
        limit: args.limit ?? 20,
      });
      const header = offline ? '(offline cache)\n' : '';
      const body =
        hits.length === 0
          ? 'No matching memory entries.'
          : hits.map((h) => `## ${h.path}\n${h.content}`).join('\n\n');
      return { content: [{ type: 'text' as const, text: header + body }] };
    },
  );

  const writeTool = tool(
    'memory_write',
    'Write or replace a memory file. Persists to gateway on sync; requires permission in safe/ask modes.',
    WriteSchema.shape,
    async (args) => {
      const path = normalizeMemoryPath(args.path);
      if (!validateMemoryPath(path)) {
        return { content: [{ type: 'text' as const, text: `Invalid memory path: ${args.path}` }], isError: true };
      }
      writeMemoryToCache(deps.workspaceRoot, path, args.content);
      const client = await deps.getClient();
      if (!client) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Saved to local cache only (gateway offline). Path: ${path}`,
            },
          ],
        };
      }
      try {
        const result = await syncGatewayMemoryToWorkspace({
          client,
          workspaceRoot: deps.workspaceRoot,
          pushPaths: [path],
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Memory saved. push_accepted=${result.pushed}, pulled=${result.pulled}`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Local cache updated; gateway sync failed: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  const deleteTool = tool(
    'memory_delete',
    'Delete a single memory file. Requires user confirmation before executing.',
    DeleteSchema.shape,
    async (args) => {
      const path = normalizeMemoryPath(args.path);
      if (!validateMemoryPath(path)) {
        return { content: [{ type: 'text' as const, text: `Invalid memory path: ${args.path}` }], isError: true };
      }
      if (deps.confirmDestructive) {
        const ok = await deps.confirmDestructive('delete', path);
        if (!ok) {
          return { content: [{ type: 'text' as const, text: 'Delete cancelled.' }] };
        }
      }
      const hadLocal = deleteMemoryFromCache(deps.workspaceRoot, path);
      const client = await deps.getClient();
      if (client) {
        try {
          await client.deleteMemoryFile(path);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: 'text' as const,
                text: hadLocal
                  ? `Local cache removed but gateway delete failed: ${msg}`
                  : `Gateway delete failed: ${msg}`,
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: 'text' as const, text: `Deleted memory file: ${path} (gateway and local cache).` }] };
      }
      if (!hadLocal) {
        return {
          content: [{ type: 'text' as const, text: `No memory file at path: ${path}` }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Deleted memory file: ${path} (local cache only; gateway offline).`,
          },
        ],
      };
    },
  );

  const clearTool = tool(
    'memory_clear',
    'Delete ALL gateway memory for this user. Requires explicit confirmation.',
    z.object({ confirm: z.literal(true).describe('Must be true to proceed') }).shape,
    async (args) => {
      if (args.confirm !== true) {
        return { content: [{ type: 'text' as const, text: 'Clear cancelled (confirm must be true).' }] };
      }
      if (deps.confirmDestructive) {
        const ok = await deps.confirmDestructive('clear', 'all memory files');
        if (!ok) {
          return { content: [{ type: 'text' as const, text: 'Clear cancelled.' }] };
        }
      }
      const client = await deps.getClient();
      if (!client) {
        return {
          content: [{ type: 'text' as const, text: 'Cannot clear gateway memory while offline.' }],
          isError: true,
        };
      }
      const res = await client.memoryClear();
      resetMemorySyncStateForTests(deps.workspaceRoot);
      return {
        content: [{ type: 'text' as const, text: `Cleared gateway memory (${res.deleted_count} file(s)).` }],
      };
    },
  );

  return createSdkMcpServer({
    name: 'memory',
    version: '1.0.0',
    tools: [readTool, searchTool, writeTool, deleteTool, clearTool],
  });
}
