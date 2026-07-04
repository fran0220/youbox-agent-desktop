import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadWorkspaceSkills } from '../../../../../packages/shared/src/skills/storage.ts';

const DESIGN_ROOT = join(import.meta.dir, '..');
const MANIFEST_PATH = join(DESIGN_ROOT, 'manifest.json');
const VENDORED_PATH = join(DESIGN_ROOT, 'VENDORED.md');
const NOTICE_PATH = join(DESIGN_ROOT, '..', '..', '..', '..', 'NOTICE');
const SIZE_LIMIT_BYTES = 15 * 1024 * 1024;

interface ManifestTemplate {
  id: string;
  name: string;
  kind: 'deck' | 'prototype' | 'doc' | 'image';
  entryFile: string;
  description: string;
}

interface ManifestDesignSystem {
  id: string;
  name: string;
  description: string;
  path: string;
}

interface ManifestSkill {
  slug: string;
  name: string;
  description: string;
  path: string;
}

interface DesignManifest {
  templates: ManifestTemplate[];
  designSystems: ManifestDesignSystem[];
  skills: ManifestSkill[];
}

function readManifest(): DesignManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as DesignManifest;
}

function listDirectories(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('__'))
    .map((entry) => entry.name)
    .sort();
}

function directorySizeBytes(path: string): number {
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    return stat.size;
  }

  return readdirSync(path).reduce(
    (total, entry) => total + directorySizeBytes(join(path, entry)),
    0
  );
}

describe('design content pack integrity', () => {
  test('manifest entries resolve to disk with required files', () => {
    const manifest = readManifest();

    expect(manifest.templates.length).toBeGreaterThanOrEqual(4);
    expect(manifest.designSystems.length).toBeGreaterThanOrEqual(8);
    expect(manifest.designSystems.length).toBeLessThanOrEqual(15);
    expect(manifest.skills.length).toBeGreaterThanOrEqual(5);
    expect(manifest.skills.length).toBeLessThanOrEqual(10);

    for (const template of manifest.templates) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.kind).toBeTruthy();
      expect(template.entryFile).toBeTruthy();
      expect(template.description).toBeTruthy();

      const templateDir = join(DESIGN_ROOT, 'templates', template.id);
      const templateManifestPath = join(templateDir, 'template.json');
      expect(existsSync(templateDir)).toBe(true);
      expect(existsSync(templateManifestPath)).toBe(true);
      expect(existsSync(join(templateDir, template.entryFile))).toBe(true);

      const templateManifest = JSON.parse(readFileSync(templateManifestPath, 'utf8')) as ManifestTemplate;
      expect(templateManifest).toMatchObject(template);
    }

    for (const system of manifest.designSystems) {
      expect(system.id).toBeTruthy();
      expect(system.name).toBeTruthy();
      expect(system.description).toBeTruthy();
      expect(system.path).toBe(`design-systems/${system.id}/DESIGN.md`);

      const systemPath = join(DESIGN_ROOT, system.path);
      expect(existsSync(systemPath)).toBe(true);
      expect(readFileSync(systemPath, 'utf8').trim().length).toBeGreaterThan(0);
    }

    for (const skill of manifest.skills) {
      expect(skill.slug).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.path).toBe(`skills/${skill.slug}/SKILL.md`);

      const skillPath = join(DESIGN_ROOT, skill.path);
      expect(existsSync(skillPath)).toBe(true);
      expect(readFileSync(skillPath, 'utf8').trim().length).toBeGreaterThan(0);
    }
  });

  test('manifest lists every vendored directory with no orphans', () => {
    const manifest = readManifest();

    expect(listDirectories(join(DESIGN_ROOT, 'templates'))).toEqual(
      manifest.templates.map((template) => template.id).sort()
    );
    expect(listDirectories(join(DESIGN_ROOT, 'design-systems'))).toEqual(
      manifest.designSystems.map((system) => system.id).sort()
    );
    expect(listDirectories(join(DESIGN_ROOT, 'skills'))).toEqual(
      manifest.skills.map((skill) => skill.slug).sort()
    );
  });

  test('upstream template licenses are present with holder names', () => {
    const guizangLicense = readFileSync(join(DESIGN_ROOT, 'templates', 'guizang-ppt', 'LICENSE'), 'utf8');
    const htmlPptLicense = readFileSync(join(DESIGN_ROOT, 'templates', 'html-ppt', 'LICENSE'), 'utf8');

    expect(guizangLicense).toContain('MIT License');
    expect(guizangLicense).toContain('op7418');
    expect(guizangLicense).toContain('歸藏');
    expect(htmlPptLicense).toContain('MIT License');
    expect(htmlPptLicense).toContain('lewis');
  });

  test('all copied upstream LICENSE files are non-empty and name holders', () => {
    const licensedDirs = [
      { path: join('templates', 'guizang-ppt', 'LICENSE'), holder: 'op7418' },
      { path: join('templates', 'html-ppt', 'LICENSE'), holder: 'lewis' },
      { path: join('skills', 'brutalist-skill', 'LICENSE'), holder: 'Leonxlnx' },
      { path: join('skills', 'gpt-tasteskill', 'LICENSE'), holder: 'Leonxlnx' },
      { path: join('skills', 'minimalist-skill', 'LICENSE'), holder: 'Leonxlnx' },
      { path: join('skills', 'web-design-guidelines', 'LICENSE'), holder: 'Vercel Labs' },
    ];

    for (const license of licensedDirs) {
      const content = readFileSync(join(DESIGN_ROOT, license.path), 'utf8');
      expect(content.trim().length).toBeGreaterThan(0);
      expect(content).toContain('MIT License');
      expect(content).toContain(license.holder);
    }
  });

  test('NOTICE carries open-design Apache-2.0 attribution', () => {
    const notice = readFileSync(NOTICE_PATH, 'utf8');

    expect(notice).toContain('open-design');
    expect(notice).toContain('github.com/nexu-io/open-design');
    expect(notice).toContain('Apache-2.0');
  });

  test('VENDORED.md records the source repository and commit hash', () => {
    const vendored = readFileSync(VENDORED_PATH, 'utf8');

    expect(vendored).toContain('github.com/nexu-io/open-design');
    expect(vendored).toMatch(/[a-f0-9]{40}/);
    expect(vendored).toContain('byte-identical');
  });

  test('resources/design stays below the 15MB payload budget', () => {
    expect(directorySizeBytes(DESIGN_ROOT)).toBeLessThan(SIZE_LIMIT_BYTES);
  });
});

describe('vendored design skills', () => {
  let workspaceRoot: string;

  beforeAll(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'design-skills-'));
    cpSync(join(DESIGN_ROOT, 'skills'), join(workspaceRoot, 'skills'), { recursive: true });
  });

  afterAll(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('all skills parse through the shared skills loader', () => {
    const manifest = readManifest();
    const skills = loadWorkspaceSkills(workspaceRoot);
    const skillsBySlug = new Map(skills.map((skill) => [skill.slug, skill]));

    expect(skills.length).toBe(manifest.skills.length);

    for (const manifestSkill of manifest.skills) {
      const skill = skillsBySlug.get(manifestSkill.slug);
      expect(skill).toBeTruthy();
      expect(skill?.metadata.name).toBeTruthy();
      expect(skill?.metadata.description).toBeTruthy();
      expect(skill?.content.trim()).not.toMatch(/^https?:\/\/\S+$/);
      expect(skill?.content).not.toContain('catalogue entry');
      expect(skill?.content).not.toContain('discovery metadata only');
    }
  });
});
