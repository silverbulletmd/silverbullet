export function etagForHash(hash: string): string {
  return `"sha256:${hash}"`;
}

export function hashFromEtag(etag: string | null): string | undefined {
  if (etag === null) {
    return undefined;
  }
  let s = etag.trim();
  if (s.startsWith("W/")) {
    return undefined;
  }
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s.slice(1, -1);
  }
  if (!s.startsWith("sha256:")) {
    return undefined;
  }
  return s.slice("sha256:".length).toLowerCase();
}
