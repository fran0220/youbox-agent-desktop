import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { StoredMessage } from '@craft-agent/core/types';
import type { StoredSession } from '@craft-agent/shared/sessions';
import {
  ensureSessionDir,
  getSessionFilePath,
  getSessionPath,
  writeSessionJsonl,
  validateSessionId,
} from '@craft-agent/shared/sessions';
import type { GatewayClient } from './gateway-client.ts';
import {
  assertClassicSessionDetail,
  assertClassicSessionSummaries,
  type ClassicChatSession,
  type ClassicSessionMessage,
  type ClassicSessionSummary,
} from './types.ts';
import {
  IMPORTED_SESSION_LABEL,
  IMPORTED_SESSION_STATUS,
} from './imported-session-constants.ts';

export { IMPORTED_SESSION_LABEL, IMPORTED_SESSION_STATUS };

export type MaterializeImportedSessionResult =
  | { action: 'created'; sessionId: string }
  | { action: 'skipped'; sessionId: string; reason: 'already_materialized' };

function emptyTokenUsage(): StoredSession['tokenUsage'] {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    contextTokens: 0,
    costUsd: 0,
  };
}

function parseIsoMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

function stableMessageId(sessionId: string, index: number, legacy: ClassicSessionMessage): string {
  const suffix =
    typeof legacy.id === 'string' && legacy.id.length > 0
      ? legacy.id
      : `${index}-${legacy.role ?? 'unknown'}`;
  return `legacy-${sessionId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
}

function normalizeContent(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const o = part as Record<string, unknown>;
          if (typeof o.text === 'string') return o.text;
          if (typeof o.content === 'string') return o.content;
        }
        try {
          return JSON.stringify(part);
        } catch {
          return '';
        }
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.content === 'string') return o.content;
    try {
      return JSON.stringify(raw);
    } catch {
      return '';
    }
  }
  return String(raw);
}

function mapLegacyRole(role: unknown): StoredMessage['type'] | null {
  if (typeof role !== 'string') return null;
  const r = role.toLowerCase();
  if (r === 'user' || r === 'human') return 'user';
  if (r === 'assistant' || r === 'ai' || r === 'bot') return 'assistant';
  if (r === 'tool' || r === 'function') return 'tool';
  if (r === 'system') return 'info';
  if (r === 'error') return 'error';
  return null;
}

/** Map one legacy chat_sessions message object to StoredMessage, or null if unusable. */
export function adaptLegacyMessage(
  sessionId: string,
  index: number,
  legacy: ClassicSessionMessage,
): StoredMessage | null {
  const role = mapLegacyRole(legacy.role);
  if (!role) return null;
  const content = normalizeContent(legacy.content);
  if (!content && role !== 'tool') {
    return null;
  }
  const timestamp = parseIsoMs(legacy.created_at, Date.now() - 1000 * index);
  const msg: StoredMessage = {
    id: stableMessageId(sessionId, index, legacy),
    type: role,
    content: content || '(empty)',
    timestamp,
  };
  if (role === 'tool') {
    if (typeof legacy.name === 'string') msg.toolName = legacy.name;
    if (typeof legacy.tool_call_id === 'string') msg.toolUseId = legacy.tool_call_id;
    if (legacy.tool_input && typeof legacy.tool_input === 'object') {
      msg.toolInput = legacy.tool_input as Record<string, unknown>;
    }
    msg.toolStatus = 'completed';
  }
  return msg;
}

export function adaptLegacyMessages(
  sessionId: string,
  messages: ClassicSessionMessage[],
): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const adapted = adaptLegacyMessage(sessionId, i, messages[i]!);
    if (adapted) out.push(adapted);
  }
  return out;
}

export function buildStoredSessionFromClassic(
  workspaceRootPath: string,
  classic: ClassicChatSession,
): StoredSession {
  const createdAt = parseIsoMs(classic.created_at, Date.now());
  const updatedAt = parseIsoMs(classic.updated_at, createdAt);
  const messages = adaptLegacyMessages(classic.id, classic.messages ?? []);
  const lastMessageAt =
    messages.length > 0
      ? Math.max(...messages.map((m) => m.timestamp ?? createdAt))
      : updatedAt;

  return {
    id: classic.id,
    workspaceRootPath,
    name: classic.title?.trim() || 'Imported session',
    createdAt,
    lastUsedAt: updatedAt,
    lastMessageAt,
    model: classic.model || undefined,
    workingDirectory: classic.workspace_path || undefined,
    sdkCwd: getSessionPath(workspaceRootPath, classic.id),
    sessionStatus: IMPORTED_SESSION_STATUS,
    labels: [IMPORTED_SESSION_LABEL],
    importedFrom: 'gateway:chat_sessions',
    hidden: false,
    isArchived: false,
    messages,
    tokenUsage: emptyTokenUsage(),
  };
}

/**
 * Write session.jsonl once for a legacy session. Skips if the file already exists (idempotent).
 */
export function materializeImportedSession(
  workspaceRootPath: string,
  classic: ClassicChatSession,
): MaterializeImportedSessionResult {
  validateSessionId(classic.id);
  const sessionFile = getSessionFilePath(workspaceRootPath, classic.id);
  if (existsSync(sessionFile)) {
    return { action: 'skipped', sessionId: classic.id, reason: 'already_materialized' };
  }
  ensureSessionDir(workspaceRootPath, classic.id);
  const stored = buildStoredSessionFromClassic(workspaceRootPath, classic);
  writeSessionJsonl(sessionFile, stored);
  return { action: 'created', sessionId: classic.id };
}

export type SyncClassicSessionsResult = {
  summaries: number;
  materialized: number;
  skipped: number;
  errors: string[];
};

/**
 * List classic sessions for the authenticated user and materialize any missing session.jsonl files.
 */
export async function syncClassicSessionsToWorkspace(
  client: GatewayClient,
  workspaceRootPath: string,
): Promise<SyncClassicSessionsResult> {
  const summariesRaw = await client.listClassicSessions();
  assertClassicSessionSummaries(summariesRaw);
  const summaries = summariesRaw as ClassicSessionSummary[];

  let materialized = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const summary of summaries) {
    try {
      validateSessionId(summary.id);
      const sessionFile = getSessionFilePath(workspaceRootPath, summary.id);
      if (existsSync(sessionFile)) {
        skipped += 1;
        continue;
      }
      const detailRaw = await client.getClassicSession(summary.id);
      assertClassicSessionDetail(detailRaw);
      const result = materializeImportedSession(workspaceRootPath, detailRaw);
      if (result.action === 'created') materialized += 1;
      else skipped += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${summary.id}: ${msg}`);
    }
  }

  return {
    summaries: summaries.length,
    materialized,
    skipped,
    errors,
  };
}

/** Test helper: write a minimal imported session dir without hitting the gateway. */
export function writeImportedSessionForTests(
  workspaceRootPath: string,
  classic: ClassicChatSession,
): void {
  const dir = getSessionPath(workspaceRootPath, classic.id);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const stored = buildStoredSessionFromClassic(workspaceRootPath, classic);
  writeSessionJsonl(join(dir, 'session.jsonl'), stored);
}
