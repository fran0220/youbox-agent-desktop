/**
 * Desktop auto-update feed configuration — points electron-updater at the gateway.
 */
import { resolveGatewayBaseUrl } from './auth.ts';

/** Path segment electron-updater appends to the generic feed base URL (e.g. latest-mac.yml). */
export const GATEWAY_UPDATER_FEED_PATH_PREFIX = '/api/desktop/release/';

/**
 * Base URL for the generic publish feed (trailing slash required by electron-updater).
 * Update checks request `{baseUrl}latest-mac.yml` (etc.) under this prefix.
 */
export function resolveGatewayUpdaterFeedBaseUrl(baseUrl?: string): string {
  const root = (baseUrl ?? resolveGatewayBaseUrl()).replace(/\/+$/, '');
  return `${root}${GATEWAY_UPDATER_FEED_PATH_PREFIX}`;
}

/** Full URL to the JSON release metadata endpoint (for diagnostics / non-updater clients). */
export function resolveGatewayReleaseLatestUrl(baseUrl?: string): string {
  const root = (baseUrl ?? resolveGatewayBaseUrl()).replace(/\/+$/, '');
  return `${root}/api/desktop/release/latest`;
}
