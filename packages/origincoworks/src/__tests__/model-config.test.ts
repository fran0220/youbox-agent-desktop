import { describe, expect, it } from 'bun:test';
import { mapGatewayModelsToCraft } from '../model-config.ts';

describe('mapGatewayModelsToCraft', () => {
  it('maps gateway model rows to pi ModelDefinition entries', () => {
    const models = mapGatewayModelsToCraft([
      {
        id: 'gpt-5.5',
        provider: 'proxy-gpt',
        label: 'GPT 5.5',
        context_window: 200_000,
        reasoning: true,
      },
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('gpt-5.5');
    expect(models[0]?.name).toBe('GPT 5.5');
    expect(models[0]?.provider).toBe('pi');
    expect(models[0]?.contextWindow).toBe(200_000);
  });
});
