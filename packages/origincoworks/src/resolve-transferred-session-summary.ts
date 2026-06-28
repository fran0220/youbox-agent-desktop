import { buildImportedSessionFallbackSummary } from './continue-from-imported.ts';

export const DEFAULT_REMOTE_TRANSFER_SUMMARY_TIMEOUT_MS = 5_000;

export type LegacyTurnForSummary = {
  role: string;
  content: string;
  isIntermediate?: boolean;
};

/**
 * Resolve transferredSessionSummary for continue-from-imported: try remote mini-model
 * summarization with a bounded wait, then fall back to transcript excerpt.
 */
export async function resolveTransferredSessionSummary(
  messages: LegacyTurnForSummary[],
  generateRemoteSummary?: () => Promise<string | null>,
  options?: { remoteTimeoutMs?: number },
): Promise<string | null> {
  const remoteTimeoutMs = options?.remoteTimeoutMs ?? DEFAULT_REMOTE_TRANSFER_SUMMARY_TIMEOUT_MS;

  if (generateRemoteSummary) {
    try {
      const remote = await Promise.race([
        generateRemoteSummary(),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), remoteTimeoutMs);
        }),
      ]);
      if (remote?.trim()) {
        return remote.trim();
      }
    } catch {
      // fall through to transcript fallback
    }
  }

  return buildImportedSessionFallbackSummary(messages);
}
