import type { CommandOverride } from "./lua.ts";

/** What saving changes in one kind of override: values to write, keys to drop */
export type OverrideChanges<T> = {
  set: Record<string, T>;
  unset: string[];
};

/**
 * Changes to the managed block of CONFIG. Overrides not mentioned are left
 * untouched, so a value written elsewhere meanwhile (e.g. by Share) survives.
 */
export type ManagedChanges = {
  config?: OverrideChanges<unknown>;
  commands?: OverrideChanges<CommandOverride>;
};

/**
 * The changes that turn the initial overrides into the current ones: keys
 * that are new or have a different value are set, missing ones unset.
 * Undefined values (e.g. non-literal Lua) are never written.
 */
export function diffOverrides<T>(
  initial: Record<string, T>,
  current: Record<string, T>,
): OverrideChanges<T> {
  const set: Record<string, T> = {};
  for (const [key, value] of Object.entries(current)) {
    if (value === undefined) continue;
    if (
      !Object.hasOwn(initial, key) ||
      JSON.stringify(initial[key]) !== JSON.stringify(value)
    ) {
      set[key] = value;
    }
  }
  const unset = Object.keys(initial).filter(
    (key) => !Object.hasOwn(current, key),
  );
  return { set, unset };
}
