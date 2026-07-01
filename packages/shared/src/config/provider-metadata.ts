/**
 * Provider metadata for user-facing error messages and recovery actions.
 *
 * YouBox Agent exposes YouBox as the single product provider. Internal adapter
 * identifiers such as `pi_compat` and `openai` are runtime implementation
 * details and must not leak into user-facing recovery copy.
 */

export interface ProviderMetadata {
  /** Display name */
  name: string
  /** Provider status page URL */
  statusPageUrl?: string
  /** Provider dashboard/billing URL */
  dashboardUrl?: string
}

/**
 * Metadata for the only user-facing provider.
 */
const YOUBOX_PROVIDER_METADATA: ProviderMetadata = {
  name: 'YouBox',
  statusPageUrl: 'https://api.you-box.com',
  dashboardUrl: 'https://api.you-box.com',
}

/**
 * Look up provider metadata. Arguments are retained for API compatibility with
 * upstream call sites, but the product provider is always YouBox.
 */
export function getProviderMetadata(
  _providerType: string,
  _piAuthProvider?: string,
): ProviderMetadata | undefined {
  return YOUBOX_PROVIDER_METADATA
}

/**
 * Get just the display name for a provider, with a fallback.
 */
export function getProviderDisplayName(
  _providerType: string,
  _piAuthProvider?: string,
): string {
  return YOUBOX_PROVIDER_METADATA.name
}
