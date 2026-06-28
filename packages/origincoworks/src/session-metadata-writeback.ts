/**
 * Push native Craft session metadata to gateway chat_sessions (not legacy imports).
 */
import type { GatewayClient } from './gateway-client.ts';
import { isImportedGatewaySession } from './is-imported-session.ts';

export type SessionMetadataWritebackPayload = {
  id: string;
  title?: string;
  model?: string;
  workspace_path?: string;
  type?: string;
};

export function shouldWriteSessionMetadataToGateway(session: {
  importedFrom?: string | null;
  sessionStatus?: string | null;
  labels?: string[] | null;
}): boolean {
  return !isImportedGatewaySession(session);
}

export async function writeSessionMetadataToGateway(options: {
  client: GatewayClient;
  payload: SessionMetadataWritebackPayload;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { client, payload } = options;
  const id = payload.id?.trim();
  if (!id) {
    return { ok: false, error: 'session id is required' };
  }

  const body: Record<string, unknown> = { id };
  if (payload.title !== undefined && payload.title !== '') {
    body.title = payload.title;
  }
  if (payload.model !== undefined) {
    body.model = payload.model;
  }
  if (payload.workspace_path !== undefined) {
    body.workspace_path = payload.workspace_path;
  }
  body.type = payload.type && payload.type !== '' ? payload.type : 'chat';

  try {
    await client.postDesktopSessionMetadata(body as {
      id: string;
      title?: string;
      model?: string;
      workspace_path?: string;
      type?: string;
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'session metadata write-back failed';
    return { ok: false, error: message };
  }
}
