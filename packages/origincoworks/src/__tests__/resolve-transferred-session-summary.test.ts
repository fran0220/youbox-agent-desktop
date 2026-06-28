import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_REMOTE_TRANSFER_SUMMARY_TIMEOUT_MS,
  resolveTransferredSessionSummary,
} from '../resolve-transferred-session-summary.ts';

const sampleMessages = [
  { role: 'user', content: 'OCTEST-TRANSCRIPT-LINE-1' },
  { role: 'assistant', content: 'OCTEST-TRANSCRIPT-LINE-2' },
];

describe('resolveTransferredSessionSummary', () => {
  it('returns remote summary when it resolves before timeout', async () => {
    const summary = await resolveTransferredSessionSummary(sampleMessages, async () => 'remote-summary');
    expect(summary).toBe('remote-summary');
  });

  it('falls back to transcript when remote generator throws', async () => {
    const summary = await resolveTransferredSessionSummary(sampleMessages, async () => {
      throw new Error('LLM unavailable');
    });
    expect(summary).toContain('OCTEST-TRANSCRIPT-LINE-1');
    expect(summary).toContain('OCTEST-TRANSCRIPT-LINE-2');
  });

  it('falls back promptly when remote generator never resolves', async () => {
    const start = Date.now();
    const summary = await resolveTransferredSessionSummary(
      sampleMessages,
      () => new Promise<string | null>(() => {}),
      { remoteTimeoutMs: 50 },
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(summary).toContain('OCTEST-TRANSCRIPT-LINE-1');
  });

  it('uses transcript fallback when no remote generator is provided', async () => {
    const summary = await resolveTransferredSessionSummary(sampleMessages);
    expect(summary).toContain('OCTEST-TRANSCRIPT-LINE-1');
  });

  it('exports a sensible default remote timeout constant', () => {
    expect(DEFAULT_REMOTE_TRANSFER_SUMMARY_TIMEOUT_MS).toBeGreaterThan(1_000);
    expect(DEFAULT_REMOTE_TRANSFER_SUMMARY_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});
