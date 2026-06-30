/**
 * Product deep-link URL scheme resolution (originai:// by default).
 * CRAFT_DEEPLINK_SCHEME overrides for multi-instance dev (e.g. originai1).
 * origincoworks:// remains accepted as a legacy alias.
 */

import { DEFAULT_DEEPLINK_SCHEME, LEGACY_DEEPLINK_SCHEME } from './product-identity.ts';

function readDeeplinkSchemeEnv(): string | undefined {
  if (typeof process === 'undefined') {
    return undefined;
  }
  return process.env.CRAFT_DEEPLINK_SCHEME;
}

/** Effective scheme name without trailing colon (e.g. `originai`). */
export function resolveDeeplinkScheme(): string {
  return readDeeplinkSchemeEnv() || DEFAULT_DEEPLINK_SCHEME;
}

/** Protocol guard for parsers (`originai:` and legacy `origincoworks:`). */
export function isProductDeepLinkProtocol(protocol: string): boolean {
  const normalized = protocol.toLowerCase();
  const expected = `${resolveDeeplinkScheme()}:`;
  return normalized === expected.toLowerCase() || normalized === `${LEGACY_DEEPLINK_SCHEME}:`;
}

/** True when the URL uses the current or legacy product deep-link scheme. */
export function isProductDeepLinkUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const scheme = resolveDeeplinkScheme();
  return lower.startsWith(`${scheme}://`) || lower.startsWith(`${LEGACY_DEEPLINK_SCHEME}://`);
}

/** Build a full deep link URL for the current product scheme. */
export function buildProductDeepLinkUrl(hostAndPath: string): string {
  const scheme = resolveDeeplinkScheme();
  const trimmed = hostAndPath.replace(/^\/+/, '');
  return `${scheme}://${trimmed}`;
}