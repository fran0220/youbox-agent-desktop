/**
 * Product deep-link URL scheme resolution (origincoworks:// by default).
 * CRAFT_DEEPLINK_SCHEME overrides for multi-instance dev (e.g. origincoworks1).
 */

import { DEFAULT_DEEPLINK_SCHEME } from './product-identity.ts';

function readDeeplinkSchemeEnv(): string | undefined {
  if (typeof process === 'undefined') {
    return undefined;
  }
  return process.env.CRAFT_DEEPLINK_SCHEME;
}

/** Effective scheme name without trailing colon (e.g. `origincoworks`). */
export function resolveDeeplinkScheme(): string {
  return readDeeplinkSchemeEnv() || DEFAULT_DEEPLINK_SCHEME;
}

/** Protocol guard for parsers (`origincoworks:`). */
export function isProductDeepLinkProtocol(protocol: string): boolean {
  const expected = `${resolveDeeplinkScheme()}:`;
  return protocol.toLowerCase() === expected.toLowerCase();
}

/** Build a full deep link URL for the current product scheme. */
export function buildProductDeepLinkUrl(hostAndPath: string): string {
  const scheme = resolveDeeplinkScheme();
  const trimmed = hostAndPath.replace(/^\/+/, '');
  return `${scheme}://${trimmed}`;
}
