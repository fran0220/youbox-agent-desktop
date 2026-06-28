/**
 * Checksum-diff read-through cache: gateway skill_files → workspace skills/{slug}/...
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join, normalize } from 'path';
import { invalidateSkillsCache } from '@craft-agent/shared/skills';
import { getWorkspaceSkillsPath } from '@craft-agent/shared/workspaces';
import { GatewayClient } from './gateway-client.ts';
import { contentChecksum } from './checksum.ts';
import type { GatewaySkillFile } from './types.ts';

const SYNC_STATE_FILE = '.gateway-skills-sync.json';

export type SkillsSyncOwnerState = Record<string, string>;

export type SkillsSyncState = {
  owners: SkillsSyncOwnerState;
};

export type SkillsSyncResult = {
  ownersChecked: string[];
  ownersPulled: string[];
  filesWritten: number;
  filesSkipped: number;
  cacheInvalidated: boolean;
};

function syncStatePath(workspaceRoot: string): string {
  return join(workspaceRoot, SYNC_STATE_FILE);
}

export function readSkillsSyncState(workspaceRoot: string): SkillsSyncState {
  const path = syncStatePath(workspaceRoot);
  if (!existsSync(path)) {
    return { owners: {} };
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as SkillsSyncState;
    if (!parsed || typeof parsed !== 'object' || !parsed.owners || typeof parsed.owners !== 'object') {
      return { owners: {} };
    }
    return { owners: { ...parsed.owners } };
  } catch {
    return { owners: {} };
  }
}

export function writeSkillsSyncState(workspaceRoot: string, state: SkillsSyncState): void {
  const path = syncStatePath(workspaceRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function parseSkillPath(filePath: string): { slug: string; relativePath: string } | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const slash = normalized.indexOf('/');
  if (slash <= 0) {
    return null;
  }
  const slug = normalized.slice(0, slash);
  const relativePath = normalized.slice(slash + 1);
  if (!slug || !relativePath || slug.includes('..') || relativePath.includes('..')) {
    return null;
  }
  return { slug, relativePath };
}

function localFileChecksum(absolutePath: string): string | null {
  if (!existsSync(absolutePath)) {
    return null;
  }
  try {
    const content = readFileSync(absolutePath, 'utf8');
    return contentChecksum(content);
  } catch {
    return null;
  }
}

export function applySkillFilesToWorkspace(
  workspaceRoot: string,
  files: GatewaySkillFile[],
): { written: number; skipped: number } {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  mkdirSync(skillsDir, { recursive: true });

  let written = 0;
  let skipped = 0;

  for (const file of files) {
    const parsed = parseSkillPath(file.file_path);
    if (!parsed) {
      continue;
    }
    const dest = join(skillsDir, parsed.slug, parsed.relativePath);
    const destNorm = normalize(dest);
    const skillsNorm = normalize(skillsDir);
    if (!destNorm.startsWith(skillsNorm)) {
      continue;
    }

    const remoteChecksum = file.checksum || contentChecksum(file.content ?? '');
    const localChecksum = localFileChecksum(dest);
    if (localChecksum === remoteChecksum) {
      skipped += 1;
      continue;
    }

    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.content ?? '', 'utf8');
    written += 1;
  }

  return { written, skipped };
}

export type PullOwnerSkillsFn = (
  owner: string,
  ifNoneMatch?: string,
) => Promise<{ status: 200 | 304; checksum: string; files: GatewaySkillFile[] }>;

export async function syncSkillsForOwner(
  workspaceRoot: string,
  owner: string,
  remoteChecksum: string,
  state: SkillsSyncState,
  pullOwner: PullOwnerSkillsFn,
): Promise<{ pulled: boolean; filesWritten: number; filesSkipped: number }> {
  const previous = state.owners[owner] ?? '';
  if (remoteChecksum && previous === remoteChecksum) {
    return { pulled: false, filesWritten: 0, filesSkipped: 0 };
  }

  const pull = await pullOwner(owner, previous || undefined);
  if (pull.status === 304) {
    if (pull.checksum) {
      state.owners[owner] = pull.checksum;
    }
    return { pulled: true, filesWritten: 0, filesSkipped: 0 };
  }

  const { written, skipped } = applySkillFilesToWorkspace(workspaceRoot, pull.files);
  state.owners[owner] = pull.checksum || remoteChecksum;
  return { pulled: true, filesWritten: written, filesSkipped: skipped };
}

export async function syncGatewaySkillsToWorkspaces(options: {
  client: GatewayClient;
  workspaceRoots: string[];
  userId: string;
}): Promise<SkillsSyncResult> {
  const { client, workspaceRoots, userId } = options;
  const checksums = await client.getSkillsChecksum();

  const ownersToSync: Array<{ owner: string; checksum: string }> = [
    { owner: 'system', checksum: checksums.system ?? '' },
  ];
  const userChecksum = checksums.user ?? '';
  if (userChecksum) {
    ownersToSync.push({ owner: userId, checksum: userChecksum });
  }

  const pullOwner: PullOwnerSkillsFn = async (owner, ifNoneMatch) => {
    return client.pullSkills(owner, ifNoneMatch);
  };

  let filesWritten = 0;
  let filesSkipped = 0;
  const ownersPulled: string[] = [];
  const ownersChecked = ownersToSync.map((o) => o.owner);

  for (const workspaceRoot of workspaceRoots) {
    const state = readSkillsSyncState(workspaceRoot);
    for (const { owner, checksum } of ownersToSync) {
      const result = await syncSkillsForOwner(workspaceRoot, owner, checksum, state, pullOwner);
      if (result.pulled) {
        if (!ownersPulled.includes(owner)) {
          ownersPulled.push(owner);
        }
        filesWritten += result.filesWritten;
        filesSkipped += result.filesSkipped;
      }
    }
    writeSkillsSyncState(workspaceRoot, state);
  }

  const cacheInvalidated = filesWritten > 0;
  if (cacheInvalidated) {
    invalidateSkillsCache();
  }

  return {
    ownersChecked,
    ownersPulled,
    filesWritten,
    filesSkipped,
    cacheInvalidated,
  };
}

/** @internal test helper — list slugs with SKILL.md under workspace skills dir */
export function listSyncedSkillSlugs(workspaceRoot: string): string[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  if (!existsSync(skillsDir)) {
    return [];
  }
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((slug) => existsSync(join(skillsDir, slug, 'SKILL.md')));
}

/** @internal test helper */
export function resetSkillsSyncStateForTests(workspaceRoot: string): void {
  const path = syncStatePath(workspaceRoot);
  if (existsSync(path)) {
    rmSync(path);
  }
}
