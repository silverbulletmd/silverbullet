// client/lib/inline_safe.ts

/** Content types the browser may render inline. Mirror of the server's
 * `is_inline_safe` (server/src/handlers/fs.rs) — keep the two tables identical.
 * `image/svg+xml` is excluded because a top-level SVG runs inline scripts. */
export function isInlineSafeContentType(contentType: string): boolean {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct === "image/svg+xml") {
    return false;
  }
  return (
    ct.startsWith("image/") ||
    ct === "application/pdf" ||
    ct.startsWith("video/") ||
    ct.startsWith("audio/")
  );
}
