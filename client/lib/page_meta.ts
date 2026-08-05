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
