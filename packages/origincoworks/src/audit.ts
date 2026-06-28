/**
 * Audit event emission to POST /api/desktop/audit (gateway audit_logs).
 */
import { GatewayClient } from './gateway-client.ts';

export interface AuditEventPayload {
  action: string;
  resource_type: string;
  resource_id: string;
}

/** Redact common secret patterns from audit resource identifiers. */
export function sanitizeAuditResourceId(value: string): string {
  let out = value;
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]');
  out = out.replace(/\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi, 'Bearer [REDACTED]');
  out = out.replace(/\b(api[_-]?key[=:]\s*)[^\s'"]+/gi, '$1[REDACTED]');
  out = out.replace(/\b(password[=:]\s*)[^\s'"]+/gi, '$1[REDACTED]');
  out = out.replace(/\b(token[=:]\s*)[0-9a-f]{32,}/gi, '$1[REDACTED]');
  if (out.length > 2048) {
    out = `${out.slice(0, 2044)}…`;
  }
  return out;
}

export async function postAuditEvent(
  baseUrl: string,
  token: string,
  payload: AuditEventPayload,
): Promise<void> {
  const client = new GatewayClient(baseUrl, token);
  await client.postDesktopAudit({
    action: payload.action,
    resource_type: payload.resource_type,
    resource_id: sanitizeAuditResourceId(payload.resource_id),
  });
}
