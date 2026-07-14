import type { Binding } from "./types.ts";

/**
 * Lower-cased, filesystem-safe version of a space name for its default folder.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * URL-ish display text for a binding; doubles as the link text in the list.
 */
export function bindingLabel(b: Binding): string {
  const port = location.port ? `:${location.port}` : "";
  if (b.host) return `${b.host}${port}`;
  if (b.port) return `${location.hostname}:${b.port}`;
  return b.prefix || "/";
}

export function spaceUrl(b: Binding): string {
  // Host-bound spaces are served by the same listener as this admin page, so
  // they live on the same port (e.g. http://test.localhost:3000/ in dev).
  if (b.host) {
    return `//${b.host}${location.port ? `:${location.port}` : ""}/`;
  }
  if (b.port) return `//${location.hostname}:${b.port}/`;
  return `${b.prefix || ""}/`;
}
