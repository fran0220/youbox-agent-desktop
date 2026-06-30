import {
  isLocalConnection,
  type LlmConnection,
} from '@config/llm-connections'

/** Stable keys for i18n (`chat.modelPicker.group.*`). Order matches display order. */
export const CONNECTION_GROUP_KEYS = {
  anthropic: 'anthropic',
  local: 'local',
  origincoworksBackend: 'origincoworksBackend',
} as const

export type ConnectionGroupKey =
  (typeof CONNECTION_GROUP_KEYS)[keyof typeof CONNECTION_GROUP_KEYS]

/**
 * Format token count for display (e.g., 1500 -> "1.5k", 200000 -> "200k").
 * Shared by the desktop model dropdown and the compact (drawer) model picker.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`
  }
  return tokens.toString()
}

/**
 * Strip the "pi/" prefix from model IDs/display names so the user sees a
 * provider-agnostic label in the picker (e.g., "pi/claude-opus" → "claude-opus").
 */
export function stripPiPrefixForDisplay(value: string): string {
  return value.startsWith('pi/') ? value.slice(3) : value
}

export type ConnectionGroup = [groupKey: ConnectionGroupKey, connections: LlmConnection[]]

/**
 * Group connections by provider type for hierarchical picker rendering.
 * Each provider section can contain multiple connections (API Key, OAuth, …).
 * Order is significant for UI: Anthropic, Local, OriginAI backend.
 * Empty groups are dropped. Labels come from `chat.modelPicker.group.<key>`.
 */
export function groupConnectionsByProvider<T extends LlmConnection>(
  connections: readonly T[],
): Array<[ConnectionGroupKey, T[]]> {
  const groups: Record<ConnectionGroupKey, T[]> = {
    [CONNECTION_GROUP_KEYS.anthropic]: [],
    [CONNECTION_GROUP_KEYS.local]: [],
    [CONNECTION_GROUP_KEYS.origincoworksBackend]: [],
  }
  for (const conn of connections) {
    const provider = conn.providerType || 'anthropic'
    if (provider === 'anthropic') {
      groups[CONNECTION_GROUP_KEYS.anthropic].push(conn)
    } else if (provider === 'pi_compat' && isLocalConnection(conn)) {
      groups[CONNECTION_GROUP_KEYS.local].push(conn)
    } else if (provider === 'pi' || provider === 'pi_compat') {
      groups[CONNECTION_GROUP_KEYS.origincoworksBackend].push(conn)
    }
  }
  return (Object.entries(groups) as Array<[ConnectionGroupKey, T[]]>).filter(
    ([, conns]) => conns.length > 0,
  )
}
