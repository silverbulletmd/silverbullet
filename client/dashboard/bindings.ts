import type { Binding } from "./types.ts";
import { bindingPrefix } from "./binding_fields.ts";

/**
 * URL-ish display text for a binding; doubles as the link text in the list.
 */
export function bindingLabel(b: Binding): string {
  const prefix = bindingPrefix(b).replace(/\/+$/, "") || "/";
  if (b.host) return `${b.host}${prefix === "/" ? "" : prefix}`;
  return prefix;
}

export function spaceUrl(b: Binding): string {
  const prefix = bindingPrefix(b).replace(/\/+$/, "") || "/";
  if (b.host) {
    return `//${b.host}${prefix === "/" ? "/" : `${prefix}/`}`;
  }
  return prefix === "/" ? "/" : `${prefix}/`;
}

export function spaceEntryUrl(
  binding: Binding,
  encryptedCentralLogin: boolean,
): string {
  const direct = spaceUrl(binding);
  if (!encryptedCentralLogin) return direct;
  const destination = new URL(direct, location.href);
  const start = new URL("/.auth/central/start", destination.origin);
  start.searchParams.set("destination", destination.href);
  start.searchParams.set("encrypt", "true");
  return start.href;
}
