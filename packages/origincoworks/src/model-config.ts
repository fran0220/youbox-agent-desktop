/**
 * Map gateway /api/desktop/config model entries to Craft ModelDefinition list.
 */
import type { ModelDefinition } from '@craft-agent/shared/config';
import type { DesktopConfigModelEntry } from './types.ts';

export function mapGatewayModelsToCraft(entries: DesktopConfigModelEntry[]): ModelDefinition[] {
  return entries.map((entry) => {
    const contextWindow =
      typeof entry.context_window === 'number' && entry.context_window > 0
        ? entry.context_window
        : 128_000;
    const label = entry.label?.trim() || entry.id;
    const shortName = label.length > 24 ? `${label.slice(0, 21)}…` : label;
    return {
      id: entry.id,
      name: label,
      shortName,
      description: `Gateway model (${entry.provider})`,
      provider: 'pi',
      contextWindow,
      supportsThinking: entry.reasoning !== false,
    };
  });
}
