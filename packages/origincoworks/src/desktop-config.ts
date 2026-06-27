/**
 * Fetch and validate GET /api/desktop/config for the authenticated desktop client.
 */
import { GatewayClient } from './gateway-client.ts';
import { assertDesktopConfigResponse, type DesktopConfigResponse } from './types.ts';

export async function fetchDesktopConfig(
  baseUrl: string,
  token: string,
): Promise<DesktopConfigResponse> {
  const client = new GatewayClient(baseUrl, token);
  const body = await client.desktopConfig();
  assertDesktopConfigResponse(body);
  return body;
}
