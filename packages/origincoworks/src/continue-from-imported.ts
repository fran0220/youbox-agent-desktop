import { isImportedGatewaySession } from './is-imported-session.ts';

export type ContinueFromImportedSessionResult = {
  sessionId: string;
};

type LegacyTurn = {
  role: string;
  content: string;
  isIntermediate?: boolean;
};

/**
 * When mini-model summarization is unavailable, build a bounded transcript
 * suitable for transferredSessionSummary one-shot injection.
 */
const MAX_MESSAGE_CHARS = 500;
const MAX_TRANSCRIPT_CHARS = 12_000;

export function buildImportedSessionFallbackSummary(messages: LegacyTurn[]): string | null {
  const transcript = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => !m.isIntermediate)
    .map(
      (m) =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, MAX_MESSAGE_CHARS)}`,
    )
    .join('\n\n');
  const trimmed = transcript.slice(0, MAX_TRANSCRIPT_CHARS).trim();
  return trimmed || null;
}

/** Session-like object that may be continued (imported legacy history only). */
export function canContinueFromImportedSession(session: {
  importedFrom?: string | null;
  sessionStatus?: string | null;
  labels?: string[] | null;
}): boolean {
  return isImportedGatewaySession(session);
}

/** Default display name for a writable session continued from imported history. */
export function buildContinuedSessionName(importedName?: string | null): string {
  const base = importedName?.trim();
  if (base) return `Continued: ${base}`;
  return 'Continued session';
}
