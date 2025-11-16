// client/input/touch_registry.ts
// Build a Map<fingers, binding> from (1) built-in defaults, (2) config ui.touch.bindings.
// Later sources override earlier ones per finger count.

export type TouchBinding = {
  fingers: number; // e.g. 2 or 3
  command: string; // e.g. "Navigate: Page Picker" | "Command: Open Palette" | other command name
  preventDefault?: boolean; // default true
};

export type TouchMapEntry = { command: string; preventDefault: boolean };

/** Built-in fallbacks that mirror current behavior */
export const defaultBindings: TouchBinding[] = [
  { fingers: 2, command: "Navigate: Page Picker", preventDefault: true },
  { fingers: 3, command: "Command: Open Palette", preventDefault: true },
];

/**
 * Merge a list of TouchBinding into a map, overriding existing entries for the same fingers.
 */
function merge(list: TouchBinding[], into: Map<number, TouchMapEntry>) {
  for (const b of list) {
    if (!b) continue;
    const pd = b.preventDefault ?? true;
    into.set(b.fingers, { command: b.command, preventDefault: pd });
  }
}

/**
 * Build a finger→binding map from defaults, config and command metadata.
 * @param commands Command registry list (objects with name + optional `touch` array)
 * @param configBindings Values from config.get("ui.touch.bindings", [])
 */
export function buildTouchMap(
  configBindings: TouchBinding[] = [],
): Map<number, TouchMapEntry> {
  const map = new Map<number, TouchMapEntry>();

  // 1) Built-in defaults
  merge(defaultBindings, map);

  // 2) Config-provided bindings (if any)
  if (Array.isArray(configBindings)) {
    merge(configBindings, map);
  }

  return map;
}
