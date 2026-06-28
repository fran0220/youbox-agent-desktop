/**
 * Resolve which skill requiredSources can be auto-enabled for a turn.
 */

export type RequiredSourcesResolution = {
  toEnable: string[];
  skipped: string[];
};

/**
 * Given required source slugs from skill frontmatter, return slugs to add to the
 * session and slugs that are missing or not usable (skipped with warning).
 */
export function resolveRequiredSourceEnables(options: {
  requiredSlugs: string[];
  currentEnabledSlugs: string[];
  usableSlugs: Set<string> | string[];
}): RequiredSourcesResolution {
  const current = new Set(options.currentEnabledSlugs);
  const usable =
    options.usableSlugs instanceof Set
      ? options.usableSlugs
      : new Set(options.usableSlugs);

  const toEnable: string[] = [];
  const skipped: string[] = [];

  const seen = new Set<string>();
  for (const raw of options.requiredSlugs) {
    const srcSlug = raw.trim();
    if (!srcSlug || seen.has(srcSlug)) continue;
    seen.add(srcSlug);

    if (current.has(srcSlug)) continue;

    if (usable.has(srcSlug)) {
      toEnable.push(srcSlug);
    } else {
      skipped.push(srcSlug);
    }
  }

  return { toEnable, skipped };
}

export function formatSkippedRequiredSourcesWarning(skipped: string[]): string {
  if (skipped.length === 0) return '';
  return `Skill requires sources that are not usable (missing or unauthenticated): ${skipped.join(', ')}`;
}
