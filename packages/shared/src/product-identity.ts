/**
 * OriginCoworks Next — product-facing identity (window title, macOS app name, packaging).
 * Internal npm scope remains @craft-agent/*; CRAFT_* env overrides still apply.
 */

/** macOS application name and default window title (CRAFT_APP_NAME overrides). */
export const PRODUCT_NAME = 'OriginCoworks Next';

/** Short brand string for welcome copy and compact UI. */
export const PRODUCT_BRAND_SHORT = 'OriginCoworks';

/** Default deep-link URL scheme (CRAFT_DEEPLINK_SCHEME overrides). */
export const DEFAULT_DEEPLINK_SCHEME = 'origincoworks';

/** macOS / electron-builder bundle identifier. */
export const PRODUCT_BUNDLE_ID = 'com.origincoworks.next';

/** Product documentation base URL (no craft.do). */
export const PRODUCT_DOCS_URL = 'https://origincoworks.local/docs';

/** MCP endpoint for bundled product docs server (placeholder until hosted). */
export const PRODUCT_DOCS_MCP_URL = 'https://origincoworks.local/docs/mcp';
