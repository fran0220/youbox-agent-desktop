import { createHash } from 'node:crypto';

const GATEWAY_CHAT_SESSION_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** Deterministic UUID for chat_sessions.id from a Craft session slug (DB column is uuid). */
export function craftSessionIdToGatewayChatSessionId(craftSessionId: string): string {
  const trimmed = craftSessionId.trim();
  if (!trimmed) {
    throw new Error('craft session id is required');
  }
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
  ) {
    return trimmed.toLowerCase();
  }
  const hash = createHash('sha1')
    .update(GATEWAY_CHAT_SESSION_NAMESPACE + trimmed)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
