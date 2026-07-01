/**
 * Deterministic MCP URL validation for YouBox Agent.
 *
 * Upstream used a Claude-powered validator specialized for Craft-hosted MCP
 * links. The YouBox fork must not call a model provider just to validate a URL,
 * and MCP servers are user/source controlled rather than restricted to any
 * Craft-hosted domain. Keep the public result shape but validate locally.
 */

import { debug } from '../utils/debug.ts';
import type { AgentError } from '../agent/errors.ts';

export interface UrlValidationResult {
  valid: boolean;
  /** Simple error message for validation failures */
  error?: string;
  /** Typed error retained for API compatibility; deterministic validation never sets it. */
  typedError?: AgentError;
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Validate an MCP HTTP URL without invoking an LLM/provider.
 */
export async function validateMcpUrl(
  rawUrl: string,
  _apiKey?: string,
  _oauthToken?: string,
): Promise<UrlValidationResult> {
  const value = rawUrl.trim();
  debug('[url-validator] Validating MCP URL:', value);

  if (!value) {
    return { valid: false, error: 'Enter an MCP server URL.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { valid: false, error: 'Enter a valid URL including the protocol, for example https://example.com/mcp.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Credentials are not allowed in MCP URLs. Configure authentication separately.' };
  }

  const localhost = isLocalhost(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localhost)) {
    return { valid: false, error: 'MCP URLs must use https://. http:// is allowed only for localhost development.' };
  }

  if (!parsed.hostname) {
    return { valid: false, error: 'MCP URL must include a hostname.' };
  }

  if (parsed.pathname === '/' || parsed.pathname === '') {
    return { valid: false, error: 'MCP URL must include the server path, for example /mcp.' };
  }

  return { valid: true };
}
