/**
 * Debounced push of local skill edits to gateway skill_files.
 */
import { GatewayClient } from '@craft-agent/origincoworks/gateway-client';
import { getStoredGatewayToken, resolveGatewayBaseUrl } from '@craft-agent/origincoworks/auth';
import { writeUserSkillToGateway } from '@craft-agent/origincoworks/skill-writeback';
import type { Logger } from '@craft-agent/server-core/runtime';

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 500;

export function scheduleGatewaySkillWriteback(
  workspaceRoot: string,
  skillSlug: string,
  log: Logger,
): void {
  const key = `${workspaceRoot}::${skillSlug}`;
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void flushGatewaySkillWriteback(workspaceRoot, skillSlug, log);
    }, DEBOUNCE_MS),
  );
}

/** @internal test helper */
export function clearGatewaySkillWritebackTimersForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

async function flushGatewaySkillWriteback(
  workspaceRoot: string,
  skillSlug: string,
  log: Logger,
): Promise<void> {
  const token = await getStoredGatewayToken();
  if (!token) {
    return;
  }
  const client = new GatewayClient(resolveGatewayBaseUrl(), token);
  const result = await writeUserSkillToGateway({
    client,
    workspaceRoot,
    skillSlug,
  });
  if (!result.ok) {
    log.warn(`[Gateway] Skill writeback for ${skillSlug}: ${result.error}`);
    return;
  }
  log.info(`[Gateway] Skill writeback for ${skillSlug}: ${result.fileCount} file(s)`);
}
