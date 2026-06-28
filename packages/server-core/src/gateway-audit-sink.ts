/**
 * Wires agent audit events to POST /api/desktop/audit via the origincoworks adapter.
 */
import {
  getStoredGatewayToken,
  resolveGatewayBaseUrl,
} from '@craft-agent/origincoworks/auth';
import { postAuditEvent } from '@craft-agent/origincoworks/audit';
import type { AgentAuditEvent } from '@craft-agent/shared/agent/audit-helpers';

export function createGatewayAuditSink(): (event: AgentAuditEvent) => void {
  return (event: AgentAuditEvent) => {
    void (async () => {
      const token = await getStoredGatewayToken();
      if (!token) return;
      await postAuditEvent(resolveGatewayBaseUrl(), token, {
        action: event.action,
        resource_type: event.resource_type,
        resource_id: event.resource_id,
      });
    })();
  };
}
