/**
 * Lower-cased, filesystem- and URL-safe version of a space name, used to
 * derive its default folder and URL prefix.
 *
 * Mirrors the server's `slug::slugify`, so a prefix typed into the Space
 * Manager, the first-run wizard, or the desktop app's space form all reach the
 * server in the same shape.
 */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The default URL prefix for a space called `name`, as an absolute path.
 *
 * The leading slash is part of the value, not decoration: a binding prefix is
 * a path, the server stores and validates it that way, and showing it in the
 * field is what makes the assembled URL in `UrlPrefixInput` read correctly. An
 * empty name yields `""` rather than a bare `"/"`, which would bind the space
 * to the server root.
 */
export function prefixFromName(name: string): string {
  const slug = slugify(name);
  return slug ? `/${slug}` : "";
}

/**
 * Force a user-typed prefix into the shape the server accepts: exactly one
 * leading slash, and a slugified body.
 *
 * Callers that hand a prefix straight to an API need this because a value
 * already starting with `/` is taken as-is by the desktop app's
 * `provision_space` command — it only slugifies input that lacks the slash, so
 * `/My Space!` would otherwise be sent through verbatim. Returns `""` for an
 * empty or slash-only input, the server's spelling of a root binding.
 */
export function normalizePrefix(raw: string): string {
  const slug = slugify(raw.replace(/^\/+/, ""));
  return slug ? `/${slug}` : "";
}
