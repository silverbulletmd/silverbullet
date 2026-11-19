import { syscall } from "../syscall.ts";

/**
 * @returns the Lucide icon's SVG markup, or null if the name isn't an icon
 */
export function svg(name: string): Promise<string | null> {
  return syscall("icon.svg", name);
}

/**
 * Renders a batch of Lucide icons to SVG markup in one round trip.
 * @returns map of icon name to SVG markup; unknown names are omitted
 */
export function resolve(names: string[]): Promise<Record<string, string>> {
  return syscall("icon.resolve", names);
}

/** @returns every available Lucide icon name, sorted */
export function names(): Promise<string[]> {
  return syscall("icon.names");
}

/** @deprecated use {@link svg} */
export function feather(name: string): Promise<string | null> {
  return syscall("icon.feather", name);
}

/** @deprecated use {@link resolve} */
export function resolveFeather(
  names: string[],
): Promise<Record<string, string>> {
  return syscall("icon.resolveFeather", names);
}
