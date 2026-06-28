/**
 * Debounced push of native session metadata to gateway chat_sessions.
 */
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client';
import { getStoredGatewayToken, resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth';
import {
  shouldWriteSessionMetadataToGateway,
  writeSessionMetadataToGateway,
} from '@craft-agent/origincoworks/session-metadata-writeback';
import { craftSessionIdToGatewayChatSessionId } from '@craft-agent/origincoworks/session-gateway-id';
import type { Logger } from '@craft-agent/server-core/runtime';

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 500;

export type GatewaySessionMetadataSnapshot = {
  sessionId: string;
  title?: string;
  model?: string;
  workspacePath?: string;
  importedFrom?: string | null;
  sessionStatus?: string | null;
  labels?: string[] | null;
};

export function scheduleGatewaySessionMetadataWriteback(
  snapshot: GatewaySessionMetadataSnapshot,
  log: Logger,
): void {
  if (!shouldWriteSessionMetadataToGateway(snapshot)) {
    return;
  }

  const key = snapshot.sessionId;
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void flushGatewaySessionMetadataWriteback(snapshot, log);
    }, DEBOUNCE_MS),
  );
}

/** @internal test helper */
export function clearGatewaySessionMetadataWritebackTimersForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

async function flushGatewaySessionMetadataWriteback(
  snapshot: GatewaySessionMetadataSnapshot,
  log: Logger,
): Promise<void> {
  const token = await getStoredGatewayToken();
  if (!token) {
    return;
  }
  const client = new GatewayClient(resolveGatewayBaseUrl(), token);
  const gatewaySessionId = craftSessionIdToGatewayChatSessionId(snapshot.sessionId);
  const result = await writeSessionMetadataToGateway({
    client,
    payload: {
      id: gatewaySessionId,
      title: snapshot.title,
      model: snapshot.model,
      workspace_path: snapshot.workspacePath,
      type: 'chat',
    },
  });
  if (!result.ok) {
    log.warn(`[Gateway] Session metadata writeback for ${snapshot.sessionId}: ${result.error}`);
    return;
  }
  log.info(`[Gateway] Session metadata writeback for ${snapshot.sessionId}`);
}
