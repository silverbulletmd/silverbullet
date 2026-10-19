import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
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

// Cached by page-list identity: rendering looks a page up for every link, and
// parsing every page's ref per link is O(links * pages).
let pageByPathCache: { pages: PageMeta[]; map: Map<string, PageMeta> } | null =
  null;

/** The pages by ref path; the first page wins, as with `allPages.find` */
export function pageByPath(allPages: PageMeta[]): Map<string, PageMeta> {
  if (pageByPathCache?.pages === allPages) {
    return pageByPathCache.map;
  }
  const map = new Map<string, PageMeta>();
  for (const p of allPages) {
    const path = parseToRef(p.ref)?.path;
    if (path !== undefined && !map.has(path)) {
      map.set(path, p);
    }
  }
  pageByPathCache = { pages: allPages, map };
  return map;
}
