/**
 * Push local workspace skill files to gateway skill_files (user-owned).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { getWorkspaceSkillsPath } from '@craft-agent/shared/workspaces';
import type { GatewayClient } from './gateway-client.ts';

export type SkillFilePayload = { path: string; content: string };

/** Collect all files under workspace skills/{slug}/ for PUT /api/skills/{id}. */
export function collectSkillFilesFromWorkspace(
  workspaceRoot: string,
  skillSlug: string,
): SkillFilePayload[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, skillSlug);
  if (!existsSync(skillDir)) {
    return [];
  }

  const files: SkillFilePayload[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(skillDir, full).replace(/\\/g, '/');
      try {
        const content = readFileSync(full, 'utf8');
        files.push({ path: rel, content });
      } catch {
        // skip unreadable files
      }
    }
  }

  walk(skillDir);
  return files;
}

export type GatewaySkillSummary = {
  id: string;
  source: string;
  editable: boolean;
};

function parseSkillsListBody(body: unknown): GatewaySkillSummary[] {
  if (!body || typeof body !== 'object') return [];
  const skills = (body as { skills?: unknown }).skills;
  if (!Array.isArray(skills)) return [];
  const out: GatewaySkillSummary[] = [];
  for (const row of skills) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string') continue;
    out.push({
      id: r.id,
      source: typeof r.source === 'string' ? r.source : '',
      editable: r.editable === true,
    });
  }
  return out;
}

/** True when gateway lists this slug as a user-editable skill. */
export async function isGatewayEditableUserSkill(
  client: GatewayClient,
  skillSlug: string,
): Promise<boolean> {
  const list = await client.listSkills();
  const summaries = parseSkillsListBody(list);
  const match = summaries.find((s) => s.id === skillSlug);
  return match?.editable === true;
}

export async function writeUserSkillToGateway(options: {
  client: GatewayClient;
  workspaceRoot: string;
  skillSlug: string;
  /** When false, skips the editable check (tests only). */
  requireEditable?: boolean;
}): Promise<{ ok: true; fileCount: number } | { ok: false; error: string }> {
  const { client, workspaceRoot, skillSlug, requireEditable = true } = options;

  const files = collectSkillFilesFromWorkspace(workspaceRoot, skillSlug);
  if (files.length === 0) {
    return { ok: false, error: 'No skill files to upload' };
  }

  if (requireEditable) {
    try {
      const editable = await isGatewayEditableUserSkill(client, skillSlug);
      if (!editable) {
        return { ok: false, error: 'Skill is not a gateway user skill' };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list gateway skills';
      return { ok: false, error: message };
    }
  }

  try {
    const result = await client.upsertUserSkill(skillSlug, files);
    return { ok: true, fileCount: result.file_count };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gateway skill upload failed';
    return { ok: false, error: message };
  }
}

/** @internal test helper */
export function skillDirHasSkillMd(workspaceRoot: string, skillSlug: string): boolean {
  const skillDir = join(getWorkspaceSkillsPath(workspaceRoot), skillSlug);
  const skillMd = join(skillDir, 'SKILL.md');
  return existsSync(skillMd) && statSync(skillMd).isFile();
}
