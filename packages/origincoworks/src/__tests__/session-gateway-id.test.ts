import { describe, expect, it } from 'bun:test';
import { craftSessionIdToGatewayChatSessionId } from '../session-gateway-id.ts';

describe('craftSessionIdToGatewayChatSessionId', () => {
  it('passes through valid UUIDs', () => {
    const uuid = '30ec0b6d-05f5-4a97-aaee-19e526546e5b';
    expect(craftSessionIdToGatewayChatSessionId(uuid)).toBe(uuid);
  });

  it('maps Craft slugs to stable UUIDs', () => {
    const a = craftSessionIdToGatewayChatSessionId('260628-swift-river');
    const b = craftSessionIdToGatewayChatSessionId('260628-swift-river');
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
