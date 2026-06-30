/**
 * OriginAI — product-facing identity (window title, macOS app name, packaging).
 * Internal npm scope remains @craft-agent/*; CRAFT_* env overrides still apply.
 */

/** macOS application name and default window title (CRAFT_APP_NAME overrides). */
export const PRODUCT_NAME = 'OriginAI';

/** Short brand string for welcome copy and compact UI. */
export const PRODUCT_BRAND_SHORT = 'OriginAI';

/** Default deep-link URL scheme (CRAFT_DEEPLINK_SCHEME overrides). */
export const DEFAULT_DEEPLINK_SCHEME = 'originai';

/** Legacy deep-link scheme kept for compatibility during rename rollout. */
export const LEGACY_DEEPLINK_SCHEME = 'origincoworks';

/** macOS / electron-builder bundle identifier (unchanged for upgrade continuity). */
export const PRODUCT_BUNDLE_ID = 'com.origincoworks.next';

/** Product documentation base URL (no craft.do). Feeds every "Learn more" / help link. */
export const PRODUCT_DOCS_URL = 'https://origincoworks.local/docs';

/** Runtime desktop version manifest feed (no craft.do). Empty until a release feed is hosted. */
export const PRODUCT_VERSIONS_URL = 'https://origincoworks.local/electron';

/** MCP endpoint for bundled product docs server (placeholder until hosted). */
export const PRODUCT_DOCS_MCP_URL = 'https://origincoworks.local/docs/mcp';