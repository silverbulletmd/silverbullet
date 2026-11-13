import { isToolingCacheName } from "../tooling_cache.ts";

// Client asset caches are named `cache-<build timestamp>` by the build.
const generationPattern = /^cache-(\d+)$/;

/**
 * The caches an activating worker should delete: everything except its own
 * generation, the tool-page caches, and the newest previous generation. A tab
 * that loaded before this worker took over still runs the previous client and
 * lazily imports that build's chunks, which neither this generation nor the
 * upgraded server has. Keeping one generation back lets those imports resolve
 * until the tab reloads.
 */
export function cachesToDelete(names: string[], current: string): string[] {
  const previous = names
    .filter((name) => name !== current && generationPattern.test(name))
    .sort(
      (a, b) =>
        Number(b.match(generationPattern)![1]) -
        Number(a.match(generationPattern)![1]),
    )[0];
  return names.filter(
    (name) =>
      name !== current && name !== previous && !isToolingCacheName(name),
  );
}
