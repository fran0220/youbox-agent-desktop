import { describe, expect, it } from 'bun:test';
import {
  buildContinuedSessionName,
  buildImportedSessionFallbackSummary,
  canContinueFromImportedSession,
} from '../continue-from-imported.ts';
import { IMPORTED_SESSION_LABEL, IMPORTED_SESSION_STATUS } from '../imported-session-constants.ts';

describe('continue-from-imported', () => {
  it('canContinueFromImportedSession is true only for imported gateway sessions', () => {
    expect(
      canContinueFromImportedSession({ importedFrom: 'gateway:chat_sessions' }),
    ).toBe(true);
    expect(
      canContinueFromImportedSession({ sessionStatus: IMPORTED_SESSION_STATUS }),
    ).toBe(true);
    expect(
      canContinueFromImportedSession({ labels: [IMPORTED_SESSION_LABEL] }),
    ).toBe(true);
    expect(canContinueFromImportedSession({})).toBe(false);
    expect(canContinueFromImportedSession({ sessionStatus: 'todo' })).toBe(false);
  });

  it('buildImportedSessionFallbackSummary preserves user/assistant transcript', () => {
    const summary = buildImportedSessionFallbackSummary([
      { role: 'user', content: 'OCTEST-TRANSCRIPT-LINE-1' },
      { role: 'assistant', content: 'ack' },
    ]);
    expect(summary).toContain('OCTEST-TRANSCRIPT-LINE-1');
    expect(summary).toContain('ack');
  });

  it('buildContinuedSessionName prefixes imported title', () => {
    expect(buildContinuedSessionName('OCTEST-IMPORT-ALPHA')).toBe(
      'Continued: OCTEST-IMPORT-ALPHA',
    );
    expect(buildContinuedSessionName('')).toBe('Continued session');
    expect(buildContinuedSessionName(undefined)).toBe('Continued session');
  });
});
