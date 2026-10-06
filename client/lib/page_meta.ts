import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";

// PageMeta.lastModified is indexed as a local-time string (see
// space.ts:fileMetaToPageMeta / localDateString), not the epoch number the
// wire-level FileMeta and file:changed event hashes use. Parsing it back
// recovers a comparable number; a Date-Time string without a zone offset is
// parsed as local time per the ES spec, which is exactly how it was built.
export function parsePageMetaLastModified(
  lastModified: string,
): number | undefined {
  return lastModified ? Date.parse(lastModified) || undefined : undefined;
}

// Fields that differ after every save even when the page's frontmatter and
// tags stay the same, so they say nothing about whether widgets reading the
// page's meta need to re-render.
const volatilePageMetaKeys = new Set([
  "lastModified",
  "created",
  "size",
  "lastOpened",
]);

function stablePageMetaEntries(meta: PageMeta): string {
  const entries = Object.entries(meta)
    .filter(([key]) => !volatilePageMetaKeys.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

/**
 * Whether two versions of a page's meta differ in anything besides the
 * bookkeeping fields every save touches (frontmatter attributes, tags, etc.).
 */
export function pageMetaContentChanged(
  previous: PageMeta | undefined,
  next: PageMeta,
): boolean {
  if (!previous) {
    return true;
  }
  return stablePageMetaEntries(previous) !== stablePageMetaEntries(next);
}
