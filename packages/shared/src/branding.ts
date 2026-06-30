/**
 * Centralized branding assets for OriginAI
 * Used by OAuth callback pages
 */

export const ORIGINCOWORKS_LOGO = [
  ' ██████  ██████  ███████ ██████  ██ ██████  ██████  ██████  ██████  ███████',
  '██    ██ ██   ██ ██      ██   ██ ██ ██   ██ ██      ██      ██   ██ ██     ',
  '██    ██ ██████  █████   ██   ██ ██ ██   ██ ██      ██  ███ ██████  █████  ',
  '██    ██ ██   ██ ██      ██   ██ ██ ██   ██ ██      ██   ██ ██   ██ ██     ',
  ' ██████  ██   ██ ███████ ██████  ██ ██████   ██████  ██████  ██   ██ ███████',
] as const;

/** @deprecated Use ORIGINCOWORKS_LOGO */
export const CRAFT_LOGO = ORIGINCOWORKS_LOGO;

/** Logo as a single string for HTML templates */
export const CRAFT_LOGO_HTML = ORIGINCOWORKS_LOGO.map((line) => line.trimEnd()).join('\n');

/** Session viewer base URL (product deployment) */
export const VIEWER_URL = 'https://origincoworks.local';
