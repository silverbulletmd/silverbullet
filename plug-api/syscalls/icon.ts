import { syscall } from "../syscall.ts";

/**
 * @returns the icon's SVG markup, or null if the name isn't a Feather icon
 */
export function feather(name: string): Promise<string | null> {
  return syscall("icon.feather", name);
}

/**
 * Renders a batch of Feather icons to SVG markup in one round trip.
 * @returns map of icon name to SVG markup; unknown names are omitted
 */
export function resolveFeather(
  names: string[],
): Promise<Record<string, string>> {
  return syscall("icon.resolveFeather", names);
}
