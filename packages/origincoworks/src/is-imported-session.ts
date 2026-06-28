import {
  IMPORTED_SESSION_LABEL,
  IMPORTED_SESSION_STATUS,
} from './imported-session-constants.ts';

/** True when a session was materialized from gateway chat_sessions (read-only history). */
export function isImportedGatewaySession(session: {
  importedFrom?: string | null;
  sessionStatus?: string | null;
  labels?: string[] | null;
}): boolean {
  if (session.importedFrom) return true;
  if (session.sessionStatus === IMPORTED_SESSION_STATUS) return true;
  const labels = session.labels ?? [];
  return labels.includes(IMPORTED_SESSION_LABEL);
}

export const IMPORTED_SESSION_READ_ONLY_ERROR =
  'This session is imported legacy history and is read-only. Continue from this session to start a new writable chat.';
