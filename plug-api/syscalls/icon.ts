import { syscall } from "../syscall.ts";

/**
 * Renders a Feather icon to SVG markup by name.
 * @param name a Feather icon name, e.g. `trash-2`
 * @returns the icon's SVG markup, or null if the name isn't a Feather icon
 */
export function feather(name: string): Promise<string | null> {
  return syscall("icon.feather", name);
}

/**
 * Renders a batch of Feather icons to SVG markup in one round trip.
 * @param names Feather icon names, e.g. `trash-2`
 * @returns map of icon name to SVG markup; unknown names are omitted
 */
export function resolveFeather(
  names: string[],
): Promise<Record<string, string>> {
  return syscall("icon.resolveFeather", names);
}
