import { describe, expect, it } from 'bun:test';
import {
  IMPORTED_SESSION_LABEL,
  IMPORTED_SESSION_STATUS,
} from '../session-import.ts';
import {
  isImportedGatewaySession,
  IMPORTED_SESSION_READ_ONLY_ERROR,
} from '../is-imported-session.ts';

describe('is-imported-session', () => {
  it('detects importedFrom provenance', () => {
    expect(isImportedGatewaySession({ importedFrom: 'gateway:chat_sessions' })).toBe(true);
  });

  it('detects imported sessionStatus', () => {
    expect(isImportedGatewaySession({ sessionStatus: IMPORTED_SESSION_STATUS })).toBe(true);
  });

  it('detects imported label', () => {
    expect(isImportedGatewaySession({ labels: [IMPORTED_SESSION_LABEL] })).toBe(true);
  });

  it('returns false for native sessions', () => {
    expect(isImportedGatewaySession({ sessionStatus: 'todo', labels: [] })).toBe(false);
  });

  it('exposes a stable read-only error message', () => {
    expect(IMPORTED_SESSION_READ_ONLY_ERROR).toContain('read-only');
  });
});
