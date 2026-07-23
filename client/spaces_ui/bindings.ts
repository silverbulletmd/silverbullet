import type { Binding } from "./types.ts";

/**
 * URL-ish display text for a binding; doubles as the link text in the list.
 */
export function bindingLabel(b: Binding): string {
  const listenerPort = location.port ? `:${location.port}` : "";
  if (b.host) return `${b.host}${listenerPort}`;
  return b.prefix || "/";
}

export function spaceUrl(b: Binding): string {
  // Host-bound spaces are served by the same listener as this admin page, so
  // they live on the same port (e.g. http://test.localhost:3000/ in dev).
  if (b.host) {
    return `//${b.host}${location.port ? `:${location.port}` : ""}/`;
  }
  // A stored prefix of "/" (a bare-root binding typed literally into the
  // Prefix field -- server/src/multi/validate.rs accepts it and never
  // normalizes it before persisting) must not survive into `${prefix}/`: that
  // would emit "//", a protocol-relative URL with an empty authority that
  // navigates nowhere useful. Strip any trailing slash(es) first so "", "/",
  // and "/foo/" all collapse the same way "/foo" would.
  const trimmed = (b.prefix || "").replace(/\/+$/, "");
  return `${trimmed}/`;
}
