import { afterEach, describe, expect, it } from 'bun:test';
import { GatewayClient } from '../gateway-client.ts';
import {
  shouldWriteSessionMetadataToGateway,
  writeSessionMetadataToGateway,
} from '../session-metadata-writeback.ts';
import { IMPORTED_SESSION_LABEL, IMPORTED_SESSION_STATUS } from '../imported-session-constants.ts';

describe('shouldWriteSessionMetadataToGateway', () => {
  it('returns false for imported legacy sessions', () => {
    expect(shouldWriteSessionMetadataToGateway({ importedFrom: 'legacy-id' })).toBe(false);
    expect(shouldWriteSessionMetadataToGateway({ sessionStatus: IMPORTED_SESSION_STATUS })).toBe(
      false,
    );
    expect(
      shouldWriteSessionMetadataToGateway({ labels: [IMPORTED_SESSION_LABEL] }),
    ).toBe(false);
  });

  it('returns true for native writable sessions', () => {
    expect(shouldWriteSessionMetadataToGateway({ sessionStatus: 'todo', labels: [] })).toBe(true);
  });
});

describe('writeSessionMetadataToGateway', () => {
  afterEach(() => {
    GatewayClient.setFetchForTests(undefined);
  });

  it('POSTs metadata to /api/desktop/session-metadata without messages', async () => {
    let postUrl = '';
    let postBody: unknown;

    GatewayClient.setFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/desktop/session-metadata') && init?.method === 'POST') {
        postUrl = url;
        postBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({
            id: 'sess-1',
            user_id: 'u1',
            title: 'My chat',
            type: 'chat',
            model: 'gpt-5.5',
            workspace_path: '/ws',
            messages: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const client = new GatewayClient('http://127.0.0.1:8847', 'a'.repeat(64));
    const result = await writeSessionMetadataToGateway({
      client,
      payload: {
        id: 'sess-1',
        title: 'My chat',
        model: 'gpt-5.5',
        workspace_path: '/ws',
      },
    });

    expect(result.ok).toBe(true);
    expect(postUrl).toContain('/api/desktop/session-metadata');
    expect(postBody).toEqual({
      id: 'sess-1',
      title: 'My chat',
      model: 'gpt-5.5',
      workspace_path: '/ws',
      type: 'chat',
    });
    expect(postBody).not.toHaveProperty('messages');
  });
});
